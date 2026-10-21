-- Prompt-injection score of an item's text (noul yes-probability, 0..1). NULL until the judge scored it.
ALTER TABLE items ADD COLUMN injection REAL;
