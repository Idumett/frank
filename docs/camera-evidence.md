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
the request trace and maximum permitted age. An unsolicited frame or a frame for
another request is rejected. This makes the frame acknowledgement name the exact
frame that was processed and prevents an earlier view from becoming a current
observation.

Android keeps at most three JPEGs in its private cache while the assistant is
open. On `frame_required`, it copies the newest frame inside the age limit and
sends its frame ID, capture time, current age and local quality value. The copy
is deleted after sending. Closing the assistant deletes the buffer.

The default limits are configurable:

- `FRAME_MAX_AGE_MS=4000`
- `FRAME_WAIT_MS=3000`
- `FRAME_CLOCK_SKEW_MS=10000`
- WebSocket frame payload: 11 MB base64 inside a 12 MB message
- Android image file: 8 MB maximum, JPEG quality 80, one local capture per second

The server measures age again on arrival and immediately before processing. Bad,
empty or stale evidence gets a reposition-and-retry response. It is not passed to
Gemini and is not described as though it were current.

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
