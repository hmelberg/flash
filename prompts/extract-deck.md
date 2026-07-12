# Document extraction mode

A source document is provided. Your task changes from *authoring* to *extracting*:
create flashcards that cover the **most important content of the document**.

## Selection strategy

- Work importance-first: core claims, definitions, mechanisms, key numbers,
  named concepts, causal relationships, and conclusions before peripheral detail.
- Coverage should follow the document's own emphasis — a section the document
  spends a third of its words on deserves roughly a third of the cards.
- **Do not invent facts.** Every card must be answerable from the document alone.
  Do not add outside knowledge, even if true.
- Prefer transforming statements into questions over quoting: the card should test
  understanding, not recognition of the document's phrasing.
- Numbers, thresholds, and definitions make excellent atomic cards.
- If the document contains tables or formulas, preserve them faithfully
  (HTML tables / KaTeX as per the format rules).

## Quantity

- Default density: **about 1 card per 100 words** of the document, unless the
  request specifies a number.
- Group cards into lessons that mirror the document's structure (its sections),
  in the document's order.

## Language

- Cards are written in the document's language unless the request says otherwise.
- All other format and quality rules from the base instructions apply unchanged.
