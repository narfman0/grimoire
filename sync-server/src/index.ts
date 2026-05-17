// Grimoire sync-server — a tiny Hocuspocus instance that brokers Y.Doc
// updates between players editing the same character sheet (or shared
// note). It persists everything to the same sqlite file the SvelteKit
// web app uses, via Hocuspocus's sqlite extension. Each Y.Doc is keyed
// by document name, which the web client picks as `character:<id>` or
// `note:<id>`.
//
// Why a separate process: Hocuspocus needs a long-lived websocket per
// client, which doesn't fit Vercel/Cloud-Run-style serverless. On srv
// this just runs as another container next to the web service.
//
// TODO(M2): authn — verify the player has joined the campaign that
// owns this character before allowing connect. Today this is wide open
// on the LAN; the docker-compose only exposes 1234 on the host.

import { Server } from '@hocuspocus/server';
import { SQLite } from '@hocuspocus/extension-sqlite';

const PORT = Number(process.env.SYNC_PORT ?? 1234);
const DB_PATH = process.env.DATABASE_URL ?? './grimoire.db';

const server = Server.configure({
  port: PORT,
  extensions: [
    new SQLite({
      database: DB_PATH
    })
  ],
  async onConnect({ documentName }) {
    console.log(`[sync] connect → ${documentName}`);
  }
});

server.listen().then(() => {
  console.log(`[sync] hocuspocus listening on :${PORT}, db=${DB_PATH}`);
});
