// See https://kit.svelte.dev/docs/types#app
declare global {
  namespace App {
    interface Error {
      message: string;
      code?: string;
      requestId?: string;
    }
    interface Locals {
      user: {
        id: string;
        username: string;
        isAdmin: boolean;
        email: string | null;
        emailVerified: boolean;
      } | null;
      requestId: string;
    }
    // interface PageData {}
    // interface Platform {}
  }
}

export {};
