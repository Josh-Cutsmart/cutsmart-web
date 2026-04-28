# CutSmart Web

Next.js web app scaffold for hosting on Vercel with Firebase Auth, Firestore, and Storage.

## Start locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Firebase setup

1. In Firebase Console, add a **Web app** under your project.
2. Copy config values into `.env.local` using `.env.example`.
3. Enable Email/Password in Authentication.
4. Create Firestore and Storage.

## Routes included

- `/login`
- `/dashboard`
- `/projects/prj_1001`
- `/sales`
- `/cutlists/initial`
- `/cutlists/production`

## Deploy to Vercel

1. Push this folder/repo to GitHub.
2. Import repo in Vercel.
3. Add all `NEXT_PUBLIC_FIREBASE_*` env vars in Vercel Project Settings.
4. Deploy.

If Firebase env vars are missing, app runs in demo mode with seeded mock data.
