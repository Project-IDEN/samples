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

Open http://localhost:5200 and allow the camera.

## Getting a good capture

- Sit close enough that your face fills the oval, with light on your face rather than behind you.
- Turn your head clearly when asked, and hold it there while the prompt says so: the frames are
  taken over about a second, and the furthest one counts. The movement is measured from your
  facial landmarks, and a small nod does not count.
- The camera preview is mirrored. The frames sent are not, so "turn to your left" means your own
  left.

Templates are kept in this browser's `localStorage`. Enrolments made under another model are marked
**other model**: they no longer compare, so enrol again.
