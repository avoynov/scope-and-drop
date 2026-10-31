# Spotter's words

Drop recordings of single spoken words here and the spotter's radio speaks with them instead of the browser's speech synthesis (`../radio-voice.ts`). No code change is needed: every audio file in this folder is picked up by name when the page loads.

A call is played from recordings only when **every** word in it has one; otherwise the whole call falls back to speech synthesis, so a half-recorded set never mixes two voices in one call.

## Names

`<word>.<ext>`, lower case, for example `wind.wav`, `point.wav`, `five.flac`. `<ext>` can be `wav`, `flac`, `ogg`, `mp3`, `m4a`, `opus` or `webm`.

Record each word on its own, said as it would be in the middle of a calm radio call, and trim it tight (start within 5 ms of the voice, end as it dies away). One voice for the whole set. Record it clean and full-band: the radio's 300–3,400 Hz band, its overdrive, the key click, the hiss and the squelch tail are added when it plays.

## The words the scope lab's spotter uses

- Wind: `wind`, `left`, `right`, `head`, `on`, `from`, `behind`, `calm`, `hold`, `centre`
- Numbers: `zero`, `one`, `two`, `three`, `four`, `five`, `six`, `seven`, `eight`, `nine`, `point` (holds are said "one point two five", ranges digit by digit, "one eight three")
- Shot calls: `hit`, `high`, `low`, `miss`, `short`, `just`, `off`, `him`, `glass`, `stopped`, `it`
- Range: `range`
- For the party lab's observers later: `target`, `moving`, and the words of their sightings.
