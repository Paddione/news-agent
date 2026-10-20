// Topic groups: a hand-set weight over several topics. Feedback never moves a group's weight.
import { conflict, int, invalid, notFound } from "../errors.ts";
import { GROUP_NAME } from "../db/repos/taste.ts";
import { tasteFrame } from "../news/taste.ts";
import { bodyOf, bool, num, str, type Handlers, type RouteDeps } from "./types.ts";

export function topicGroupRoutes({
  app,
}: RouteDeps): Handlers<"groups.list" | "groups.add" | "groups.update" | "groups.remove"> {
  const { store } = app;
  const name = (value: string) => {
    if (!GROUP_NAME.test(value) || value.length > 40)
      throw invalid(`Group names are kebab-case, 1 to 40 characters: "${value}"`);
    return value;
  };
  const unique = (value: string, id?: number) => {
    const other = store.taste.findGroup(value);
    if (other && other.id !== id) throw conflict(`A group "${value}" already exists`);
    return value;
  };
  return {
    "groups.list": (_req, res) => res.json(store.taste.groups()),
    "groups.add": (req, res) => {
      const body = bodyOf(req);
      const group = store.taste.addGroup(
        unique(name(str(body, "name", { max: 40 }))),
        num(body, "weight", { min: 0.1, max: 2 }) ?? 1,
        bool(body, "enabled") ?? true,
      );
      app.log.info("taste.group_added", { id: group.id, name: group.name });
      app.bus.publish(tasteFrame(store));
      res.status(201).json(group);
    },
    "groups.update": (req, res) => {
      const id = int(req.params.id, "id");
      if (!store.taste.group(id)) throw notFound(`No topic group ${req.params.id}`);
      const body = bodyOf(req);
      const rename = str(body, "name", { max: 40, optional: true });
      const group = store.taste.updateGroup(id, {
        name: rename === undefined ? undefined : unique(name(rename), id),
        weight: num(body, "weight", { min: 0.1, max: 2 }),
        enabled: bool(body, "enabled"),
      })!;
      app.bus.publish(tasteFrame(store));
      res.json(group);
    },
    "groups.remove": (req, res) => {
      if (!store.taste.removeGroup(int(req.params.id, "id")))
        throw notFound(`No topic group ${req.params.id}`);
      app.bus.publish(tasteFrame(store));
      res.json({ ok: true });
    },
  };
}
