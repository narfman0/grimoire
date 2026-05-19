// Legacy detail route. Moved to /content/browse/[author]/[kind]/[slug].
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
  throw redirect(
    308,
    `/content/browse/${encodeURIComponent(params.author)}/${encodeURIComponent(params.kind)}/${encodeURIComponent(params.slug)}${url.search}`
  );
};
