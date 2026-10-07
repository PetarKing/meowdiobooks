# Remote Luna recipe and pricing

The optional remote recipe uses `gpt-6-luna` with `service_tier = "fast"`. The model registry's
reasoning effort remains `low`; Dialogue retains its independent `low` and `medium` passes and
selective `high` adjudication. Local Qwen defaults and voice recipes are unchanged.

Prices were verified on 2026-10-07 against the official [pricing catalog](https://developers.openai.com/api/docs/pricing),
[Luna model page](https://developers.openai.com/api/docs/models/gpt-6-luna), and
[Fast processing guide](https://developers.openai.com/api/docs/guides/priority-processing).
`priority` is the supported alias for `fast`. This snapshot is recorded in `pricing_version`.

| Token class (USD per million) | Fast, input ≤272,000 | Fast, input >272,000 |
| --- | ---: | ---: |
| Uncached input | 0.20 | 0.40 |
| Cached input | 0.02 | 0.04 |
| Cache write | 0.25 | 0.50 |
| Output, including reasoning | 1.00 | 1.50 |

The long-context threshold applies per physical request to all tokens, including its output.
Default processing costs half these rates. Both remote adapters request Fast and preserve the actual
response tier in usage events as `serviceTier`. Cost estimates use the returned tier when present;
missing tiers use the configured rate as an estimate. Unknown explicit tiers fail pricing rather than
silently inventing a rate; successful Dialogue attribution is preserved without a cost estimate. Hosts performing settlement can retain their reservation when actual tier
or usage evidence is missing. Dialogue prices requests individually before aggregating their cost.
Its artifact summary counts successful parsed Responses calls, as before; failed HTTP/transport/JSON
attempts are separately exposed through admission/completion events and may have unknown charges.
Existing external profiles without tier or long-context fields retain their prior flat-rate behavior.

## Planning estimate and evidence

The previous full-book workload covered 1,903 targets in 861 physical requests. Its aggregate usage
was 5,503,696 input tokens, including 1,827,093 cached tokens and 3,674,020 cache-write tokens,
and 656,997 output tokens. Its largest individual input was 17,103 tokens, below the threshold.
Repricing exactly that workload gives:

- Previous Luna 5.6 price: $1.74395986.
- Luna 6 Fast price: $1.61256046.
- Per target: $0.000847378, rounded up to the configured **$0.00085**.

This is a historical-workload planning estimate, not newly measured Luna 6 usage, latency or quality.
Changing model output length, retry rate or disagreement rate changes actual cost. A 938-target
preview therefore changes from $0.86 to $0.80. Actual long-context requests use the separate rate
schedule; the historical per-target workload does not predict such requests.

The former remote quality benchmark (586 samples, false-character rate 0.0085, speaker recall 0.9701)
measured Luna 5.6. It is removed from the active recipe so the interface cannot present it as Luna 6
quality. The local model's independently measured benchmark remains intact.
