# Our commitment to personal users

Meowdiobooks is one audiobook workflow shared by a personal, self-hosted application and a
commercial hosted service. The personal edition is a complete application, not a demo for the
hosted service.

## Ongoing support and quality

As long as we continue to offer Meowdiobooks commercially, we commit to maintaining the personal
edition and publishing improvements to the shared workflow here. Extraction, review, casting,
generation, export and the default workflow interface belong in this repository. Hosting,
accounts, payments and service operations belong in the commercial companion.

We will not turn the personal edition into a subscription-only shell, deliberately remove its
self-hosting capabilities to drive sales, or require a Meowdiobooks account to run it. Your local
books, accepted work, voice samples and exports remain under your control. Personal noncommercial
use is permitted by the [license](../LICENSE); commercial use requires separate permission.

We treat preservation of accepted work and exports as a release requirement. Changes to persisted
formats must come with an explicit upgrade path and verification. Keep backups before upgrading;
this commitment is not a claim that software can never contain a bug. We publish limitations,
review regressions, and prioritize fixes that protect source fidelity and user work.

Support is through repository issues and reviewed contributions, without a guaranteed response
time or support contract. Security issues have a [private reporting channel](../SECURITY.md).
Supported platforms and setup requirements are documented in [Setup](SETUP.md).

## Your models and your data

The application supports configured local models and reusable execution adapters. V1 runs voice
design, voice cloning, transcription and chapter audio locally on supported Apple Silicon Macs.
Dialogue has local and optional remote routes. The default Review policy uses OpenAI Luna for
its intended balance of cost, quality and speed; bounded book passages leave the Mac for that pass.
No Meowdiobooks subscription is needed, but the current Review pass requires your own OpenAI API key.

A completely local Review implementation is possible architectural work, not a supported V1
configuration. The current policy explicitly requires `gpt-6-luna`, Decisions classification and
Responses repair. A server advertising OpenAI-compatible chat completions does not implement
those contracts automatically. A replacement must preserve typed decisions, source anchors,
repair validation, cancellation and failure handling, and demonstrate quality on the evaluation
fixtures before it is advertised as supported. We welcome contributions toward that adapter.

The personal application does not include the hosted service's PostHog integration. Configured
model providers have their own data-handling terms; local storage does not mean every configured
inference request is offline.

## A shared effort

We ask the community to give back through reproducible bug reports, documentation, testing,
model adapters and carefully reviewed improvements. These contributions can improve both the
personal edition and the experience of paying users. Commercial work on the common engine should
benefit personal users in return.

External contributions follow the [contributor guidance](CONTRIBUTING.md) and
[Contributor License Agreement](../CLA.md). Contributors retain ownership while allowing the
project to use accepted work in both editions. Required third-party notices remain intact.
