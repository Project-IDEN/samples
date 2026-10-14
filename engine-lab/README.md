# IDEN Engine Lab

A small web app for trying IDEN's biometric engine directly, without the provider: capture a face
the way the kiosk and the sign-in page do, and see every verdict the engine returns.

| Tab | What it does | Engine call |
|---|---|---|
| **Live capture → Enrol** | Runs a random challenge (3 straight-ahead frames, then 2 head movements) and keeps the templates in this browser under a name | `POST /enroll` |
| **Live capture → Verify** | The same challenge, compared with someone enrolled here | `POST /verify` |
| **Compare photos** | Embeds photos one by one and shows the cosine similarity of every pair against the match threshold. Recognition only, no liveness | `POST /embed` |

Each result shows whether the capture was usable, the reasons when it was not (`too_dark`,
`out_of_frame`, …), every liveness check with its score, and the similarity. The frames sent are
shown below with their steps; ★ marks those kept as templates.

**The capture waits for you.** A head tracker in the browser — MediaPipe's face landmarker,
running locally — follows your head. Straight-ahead frames are taken once you face the camera; a
movement's frames once a bar shows you have turned far enough, while you hold it. Each step waits up
to 8 seconds, then says what it did not see, without sending anything. The engine still judges
every frame it receives; the tracker only decides when to take them. Under the camera, the lab
shows the tracker's live yaw and pitch: compare them with the movement the engine logs to tune
`TRIGGER` in `src/lib/guided-capture.ts`, which is set from MediaPipe's canonical face (about 25° of
turn, 20° of tilt) and not yet checked on real faces. If the tracker cannot load, the lab falls back
to a timed capture.

The browser never talks to the engine. A route handler (`src/app/api/engine/[op]/route.ts`)
forwards each call and adds the engine's token, which stays on the server.

## Run it

You need the engine running. From the IDEN repository's `engine/`:

```bash
uv sync --extra cpu
uv run python -m scripts.fetch_models
uv run uvicorn engine.app:app --port 8002
```

Without `ENGINE_TOKEN_FILE` the engine accepts any caller; that is for development only. Then here:

```bash
cp .env.example .env.local   # set ENGINE_URL and the token, or delete the token lines
pnpm install
pnpm dev
```

`pnpm dev` and `pnpm build` first put the tracker's files in `public/tracker` (about 26 MB, not
committed): MediaPipe's WASM runtime from `node_modules`, and the face landmarker model, downloaded
once and checked against its sha256. Nothing is fetched from a CDN at run time.

Open http://localhost:5200 and allow the camera.

## Getting a good capture

- Sit close enough that your face fills the oval, with light on your face rather than behind you.
- Turn your head until the bar fills, and hold it there while the prompt says so. The movement is
  measured from your facial landmarks, and a small nod does not count.
- The camera preview is mirrored. The frames sent are not, so "turn to your left" means your own
  left.

Templates are kept in this browser's `localStorage`. Enrolments made under another model are marked
**other model**: they no longer compare, so enrol again.
