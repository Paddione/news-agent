// A card becomes a GitHub issue in the configured inbox repo, once. The repo never comes from the request.
import { ApiFault, int, notFound } from "../errors.ts";
import { IssueTrackerError, issueFor } from "../news/issues.ts";
import { startInvestigation } from "../news/investigate.ts";
import { bodyOf, str, type Handlers, type RouteDeps } from "./types.ts";

export function issueRoutes({ app }: RouteDeps): Handlers<"cards.issue"> {
  const { store } = app;
  return {
    "cards.issue": async (req, res) => {
      const id = int(req.params.id, "id");
      const card = store.news.card(id);
      if (!card) throw notFound(`No card ${req.params.id}`);
      const note = str(bodyOf(req), "note", { max: 2000, optional: true });
      const existing = store.news.cardIssue(id);
      if (existing) return res.json(existing);
      const item = card.itemId ? store.news.item(card.itemId) : undefined;
      const input = issueFor(
        card,
        item,
        item ? store.news.findings(item.id) : [],
        note,
        app.config.issueLabel,
      );
      let created;
      try {
        created = await app.issues.create(input);
      } catch (e) {
        if (e instanceof IssueTrackerError) throw new ApiFault("unavailable", e.message);
        throw e;
      }
      const issue = store.news.addCardIssue(id, {
        repo: app.issues.repo,
        number: created.number,
        url: created.url,
        note: note?.trim() || undefined,
      });
      startInvestigation(app, issue.repo, issue.number, id).catch((err) => {
        app.log.warn("investigate.start_failed", { error: err.message });
      });
      app.log.info("issue.created", { cardId: id, repo: issue.repo, number: issue.number });
      app.bus.publish({ type: "feed.card_updated", card: store.news.card(id)! });
      res.status(201).json(issue);
    },
  };
}
