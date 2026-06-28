export function campaignUrl(dmUsername: string, slug: string): string {
  return `/campaigns/${dmUsername}/${slug}`;
}

export function encountersUrl(dmUsername: string, slug: string): string {
  return `/campaigns/${dmUsername}/${slug}/encounters`;
}

export function encounterUrl(dmUsername: string, campaignSlug: string, encounterId: string): string {
  return `/campaigns/${dmUsername}/${campaignSlug}/encounters/${encounterId}`;
}

export function characterUrl(username: string | null | undefined, slug: string | null | undefined): string | undefined {
  if (!username || !slug) return undefined;
  return `/characters/${username}/${slug}`;
}
