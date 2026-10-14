/**
 * Client-side service contracts — the exact API surface this plugin consumes
 * from the harness web half. TYPE-ONLY: the runtime services come from the
 * user's harness.
 */

import type { Context } from '@deepseek-ai/cordis'

type RpcResult<T> = { ok: true; value: T } | { ok: false; error: { code?: string; message?: string } }

export interface ClientConnectionRpc {
  call(channel: string, endpoint: string, payload: unknown): Promise<RpcResult<unknown>>
}

export interface LocaleService {
  register(ns: string, dicts: Record<string, Record<string, string>>): () => void
  bind(ns: string): (key: string, params?: Record<string, string | number>) => string
  subscribe(fn: () => void): () => void
}

export interface SlotRegistration {
  name: string
  /** List slots are matched by `id`; keyed config slots by `key`. */
  id?: string
  /** `<package name>#<row id>` for keyed config slots such as `plugins.row.config`. */
  key?: string
  order?: number
  label?: () => string
  locale?: string
  inject?: () => unknown
}

export interface SlotsService {
  inject(name: string, callback: () => unknown): unknown
  register(registration: SlotRegistration, component: (props: never) => unknown): unknown
  entries(name: string): { options: { key?: string } }[]
}

/**
 * One settings namespace's shared form, as the Plugins page hands it out.
 *
 * Deliberately structural and permissive: the exact snapshot fields are a
 * harness detail, so every read is guarded and the card degrades to a message
 * rather than throwing if a field is missing.
 */
export interface ConfigFormSnapshot {
  status?: string
  writable?: boolean
  value?: Record<string, unknown>
  revision?: number
}

export interface ConfigFormScope {
  getSnapshot(): ConfigFormSnapshot
  subscribe(listener: () => void): () => void
  /** One fenced mutation; a falsy result means the revision was refused. */
  mutate(ops: unknown[], revision?: number): Promise<unknown> | unknown
}

export interface ConfigFormsService {
  get(namespace: string): ConfigFormScope
  /** Run `register` while any of `namespaces` is served; dispose it otherwise. */
  whileServed(namespaces: string[], register: () => unknown): unknown
}

/** The client context: cordis plus the services this plugin injects. */
export type ClientCtx = Context & {
  connection: { rpc: ClientConnectionRpc }
  locale: LocaleService
  slots: SlotsService
  configForms: ConfigFormsService
}
