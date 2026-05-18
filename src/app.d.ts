// See https://kit.svelte.dev/docs/types#app
declare global {
  namespace App {
    // interface Error {}
    interface Locals {
      user: { id: string; username: string; isAdmin: boolean } | null;
    }
    // interface PageData {}
    // interface Platform {}
  }
}

export {};
