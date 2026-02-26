import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { SELECTED_ORG_COOKIE } from '@/lib/selected-org';
import { createClient } from '@/supabase/utils/server';

function sanitizeQuery(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function buildWebSearchQuery(value: string): string {
  const terms = value
    .split(/\s+/)
    .filter(Boolean)
    .map(term => (term.endsWith('*') ? term : `${term}*`));
  return terms.join(' ');
}

function escapeLikePattern(value: string): string {
  return value.replace(/[%_]/g, match => `\\${match}`);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawQuery = (searchParams.get('q') ?? '').trim();
  if (!rawQuery) {
    return NextResponse.json({ tickets: [] });
  }

  const sanitized = sanitizeQuery(rawQuery);
  if (!sanitized) {
    return NextResponse.json({ tickets: [] });
  }

  const textSearchQuery = buildWebSearchQuery(sanitized);
  if (!textSearchQuery) {
    return NextResponse.json({ tickets: [] });
  }

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const cookieStore = cookies();
  const selectedOrgValue = (await cookieStore).get(SELECTED_ORG_COOKIE)?.value;
  const parsedOrgId = selectedOrgValue ? Number(selectedOrgValue) : undefined;
  const organizationId =
    Number.isFinite(parsedOrgId ?? 0) && (parsedOrgId ?? 0) > 0 ? parsedOrgId : undefined;

  let query = supabase
    .from('tickets')
    .select('id,title,project_id,organization_id,status,project:projects(name)')
    .order('updated_at', { ascending: false })
    .limit(6);

  if (organizationId) {
    query = query.eq('organization_id', organizationId);
  }

  const { data, error } = await query.textSearch('search_vector', textSearchQuery, {
    config: 'english',
    type: 'websearch'
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if ((data?.length ?? 0) > 0) {
    return NextResponse.json({ tickets: data ?? [] });
  }

  const escapedPattern = escapeLikePattern(sanitized);
  let fallbackQuery = supabase
    .from('tickets')
    .select('id,title,project_id,organization_id,status,project:projects(name)')
    .ilike('title', `%${escapedPattern}%`)
    .order('updated_at', { ascending: false })
    .limit(6);

  if (organizationId) {
    fallbackQuery = fallbackQuery.eq('organization_id', organizationId);
  }

  const { data: fallbackData, error: fallbackError } = await fallbackQuery;
  if (fallbackError) {
    return NextResponse.json({ error: fallbackError.message }, { status: 500 });
  }

  return NextResponse.json({ tickets: fallbackData ?? [] });
}
