// Entry point for a worker thread whose real module is TypeScript. Pass the .ts module's URL as
// `workerData.entry`; the rest of `workerData` is the worker's own.
//
// Why not `new Worker(file.ts, {execArgv: ['--import', 'tsx']})`: on Node 22.12 (the engines floor)
// the hooks `--import tsx` registers do not apply to a worker's ENTRY module, so the worker fails
// with `Unknown file extension ".ts"` (CI node 22.12, 2026-11-15). Loading this plain-JS entry and
// importing the TypeScript module through tsx's API behaves the same on every supported Node.
import {workerData} from 'node:worker_threads'
import {tsImport} from 'tsx/esm/api'

await tsImport(workerData.entry, import.meta.url)
