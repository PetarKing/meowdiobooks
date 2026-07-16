# Phase 1 — Extract

## Purpose

Choose which local extraction library most faithfully reconstructs the PDF and publish one accepted
source-text revision for every later phase.

## Phase contract

```text
Input:  integrity-checked local PDF source + one extraction method
Work:   preview pages → run the same method over the complete PDF
Output: immutable ordered pages/blocks with source text and warnings
Gate:   Dialogue may consume only the published Extraction revision
```

Example: the user previews page 37 with LiteParse, accepts that method, and the complete run stores
page 37 as ordered blocks such as `p37-b1`, `p37-b2`. Dialogue receives those exact blocks; it never
opens the PDF independently.

## AI use — NO AI

Extraction uses local PDF parsing libraries. It sends no prompt and has no model input or output.
Chapter-heading candidates and warnings are deterministic hints, not AI conclusions.

## User sees

- Three methods: LiteParse, Native PDF text and Layout-aware extraction.
- Original rendered page beside extracted text.
- Opening, early, middle, late and final representative pages plus arbitrary page navigation.
- Method runtime, cached status and extraction warnings.

## Submit and processing

After submit, the application runs the selected method over the complete PDF. It publishes:

- page text in source order;
- stable paragraph/block IDs and exact page-relative source ranges;
- layout/reading-order evidence available from the extractor;
- chapter/boundary candidates without deciding their final semantic role;
- extraction warnings and method/version provenance.

No mandatory document-Qwen pass runs here. Language detection, label classification and speaker
inference do not belong inside extraction.

## Publication

The user compares representative or arbitrary pages before starting the complete-book run. A
successful run publishes the selected method's extraction atomically; there is no separate result
confirmation when no additional evidence can be inspected. Extraction warnings remain attached to
their source pages and are resolved in Review unless they block trustworthy Dialogue processing.

## Artifact and gate

The published Extraction revision is immutable and is the only source revision Dialogue may consume.
Every block has stable identity within that revision. Changing extraction invalidates Dialogue and all
downstream artifacts; the last accepted playable revisions remain retained until clean-break reset or
replacement acceptance.

## Tests

- the same preview/full method configuration;
- page/block order and exact source coverage;
- empty, image-only, multi-column and malformed pages;
- representative and arbitrary page previews;
- atomic complete-book publication;
- downstream invalidation on extraction replacement.
