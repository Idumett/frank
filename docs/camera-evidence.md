# Camera evidence

Frank treats a camera frame as evidence for one request, never as ambient context.

## When the camera is used

| Intent                              | Camera   | Provider work     |
| ----------------------------------- | -------- | ----------------- |
| Read text                           | Required | OCR               |
| Describe a scene                    | Required | Labels            |
| Remember this                       | Required | OCR and labels    |
| Recall a memory                     | Never    | Memory search     |
| Time, general help and conversation | Never    | Text context only |

The server decides after speech recognition. It then sends `frame_required` with
the request trace, a one-use capture-request ID and maximum permitted age. Android
waits for a frame captured after that message arrived and returns the capture ID.
An unsolicited frame, a frame for another turn, or a frame copied for an earlier
capture request is rejected. The acknowledgement names the exact frame processed.

Android starts a focused capture while the user is speaking and keeps at most
three JPEGs in its private cache. After audio has been queued, the newest eligible
frame uploads over a separate authenticated HTTP request. Audio therefore keeps
priority on the WebSocket while speech recognition and image transfer run in
parallel. The server holds the frame in memory for no more than ten seconds.

After semantic classification, a visual request consumes that prepared frame.
A nonvisual request marks it rejected and discards it without decoding it or
calling an image provider. If the prepared upload is missing, Android and the
server retain the `frame_required` flow as a slower fallback. All local copies
are deleted after sending or when the assistant closes.

The default limits are configurable:

- `FRAME_MAX_AGE_MS=4000`
- `FRAME_WAIT_MS=5000`
- `FRAME_CLOCK_SKEW_MS=10000`
- WebSocket frame payload: 11 MB base64 inside a 12 MB message
- Android image file: 8 MB maximum, JPEG quality 80, one local capture per second
- Prepared evidence wait after classification: 500 ms
- Prepared evidence cache: two frames per user, 32 globally, ten-second expiry

The server measures age again on arrival and immediately before processing. It
decodes the image to assess pixel brightness, exposure, visual detail and likely
blur. Bad, empty or stale evidence gets a reposition-and-retry response. The
diagnostic result records frame identity, capture time, final age and quality
notes without retaining the image itself.

## Provider comparison

The repeatable comparison command is:

```sh
pnpm compare:vision -- path/to/image.jpg
```

It runs Google Vision OCR and labels beside direct Gemini image understanding and
prints latency, extracted content and Gemini token usage. On the initial synthetic
station-sign check, Vision OCR reproduced all three lines exactly in about 0.4
seconds. Labels were generic. Direct Gemini took about 2 seconds and gave a useful
combined description, while consuming 1,140 input tokens for the image and prompt.

The production route keeps the narrower structured providers for now: OCR for
reading, labels for describing, and both when saving a memory. Direct Gemini image
input should be reconsidered after the same comparison is run against a small set
of real phone frames containing documents, signs, rooms, products, blur and low
light. That avoids choosing a provider from one clean generated image and keeps
the current grounded fallback available.
