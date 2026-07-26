// Auth UI smoke: signup → logout → login through the real forms.
//
// Selector note: these forms may migrate from fetch()-based submits to
// SvelteKit form actions + use:enhance. Everything here goes through
// role/label queries and user-visible copy, so the mechanics of submission
// are irrelevant to the test.

import { test, expect } from '@playwright/test';
import { uniqueUsername, PASSWORD } from './helpers';

test('signup, logout, and login via the UI forms; bad password shows an error', async ({
  page
}) => {
  const username = uniqueUsername('e2e_auth');

  // ---- signup -------------------------------------------------------------
  await page.goto('/signup');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Email').fill(`${username}@e2e.example.com`);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.getByRole('button', { name: /sign up/i }).click();

  // Logged-in shell: username + Log out control in the header.
  const logoutButton = page.getByRole('button', { name: /log out/i });
  await expect(logoutButton).toBeVisible();
  await expect(page.getByRole('link', { name: username })).toBeVisible();

  // ---- logout -------------------------------------------------------------
  await logoutButton.click();
  await expect(page.getByRole('link', { name: /log in/i })).toBeVisible();

  // ---- login: wrong password shows an error, session stays logged out -----
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill('definitely-wrong-pw');
  await page.getByRole('button', { name: /log in/i }).click();
  await expect(page.getByText(/invalid|incorrect/i)).toBeVisible();
  await expect(logoutButton).toHaveCount(0);

  // ---- login: correct password lands back in the logged-in shell ----------
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: /log in/i }).click();
  await expect(logoutButton).toBeVisible();
  await expect(page.getByRole('link', { name: username })).toBeVisible();
});
