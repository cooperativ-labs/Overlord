import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { createClient } from '@/supabase/utils/server';
import { SELECTED_ORG_COOKIE } from '@/lib/selected-org';

type SearchTicket = {
  id: string;
  title: string | null;
  ticket_number: string | null;
  project_id: string | null;
  organization_id: number;
  status: string;
  project: {
    name: string | null;
  } | null;
};

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
    .select('id,title,ticket_number,project_id,organization_id,status,project:projects(name)')
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

  return NextResponse.json({ tickets: data ?? [] });
}
