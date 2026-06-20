const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_PAGE_SIZE = 1000;

let client = null;

function getSupabase() {
    if (!supabaseUrl || !supabaseKey) {
        throw new Error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis');
    }
    if (!client) {
        client = createClient(supabaseUrl, supabaseKey, {
            auth: { persistSession: false, autoRefreshToken: false },
        });
    }
    return client;
}

async function fetchAllPaginated(makeQuery) {
    const all = [];
    let from = 0;

    while (true) {
        const to = from + SUPABASE_PAGE_SIZE - 1;
        const { data, error } = await makeQuery().range(from, to);
        if (error) throw error;
        const batch = data || [];
        all.push(...batch);
        if (batch.length < SUPABASE_PAGE_SIZE) break;
        from += SUPABASE_PAGE_SIZE;
    }

    return all;
}

async function fetchManagers({ search = '', contactType = '' } = {}) {
    const sb = getSupabase();
    let query = sb.from('managers').select('*').order('nom', { ascending: true });

    if (search) {
        query = query.ilike('nom', `%${search}%`);
    }
    if (contactType && contactType !== 'all') {
        query = query.eq('contact_type', contactType);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
}

async function fetchManagerById(id) {
    const sb = getSupabase();
    const { data, error } = await sb.from('managers').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data;
}

async function fetchTestManager() {
    const sb = getSupabase();
    const { data, error } = await sb.from('managers').select('*').eq('is_test', true).limit(1).maybeSingle();
    if (error) throw error;
    return data;
}

async function fetchManagerStats() {
    const sb = getSupabase();
    const { data, error } = await sb.from('managers').select('has_phone, has_email, contact_type');
    if (error) throw error;
    const rows = data || [];
    const stats = {
        total: rows.length,
        withPhone: rows.filter((r) => r.has_phone).length,
        withEmail: rows.filter((r) => r.has_email).length,
        both: rows.filter((r) => r.contact_type === 'both').length,
        phoneOnly: rows.filter((r) => r.contact_type === 'phone_only').length,
        emailOnly: rows.filter((r) => r.contact_type === 'email_only').length,
        none: rows.filter((r) => r.contact_type === 'none').length,
    };
    return stats;
}

async function fetchManagersWithPhone(limit = 10) {
    const sb = getSupabase();
    const { data, error } = await sb
        .from('managers')
        .select('nom, telephone, email')
        .eq('has_phone', true)
        .order('nom')
        .limit(limit);
    if (error) throw error;
    return data || [];
}

async function fetchManagersForBroadcast(channel = 'email') {
    const sb = getSupabase();
    let query = sb.from('managers').select('*').order('nom', { ascending: true });
    if (channel === 'email') {
        query = query.eq('has_email', true);
    } else if (channel === 'whatsapp' || channel === 'phone') {
        query = query.eq('has_phone', true);
    }
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
}

async function fetchPromoteurs({ search = '', contactType = '' } = {}) {
    const sb = getSupabase();
    let query = sb.from('promoteurs').select('*').order('nom', { ascending: true });

    if (search) {
        query = query.ilike('nom', `%${search}%`);
    }
    if (contactType && contactType !== 'all') {
        query = query.eq('contact_type', contactType);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
}

async function fetchPromoteurById(id) {
    const sb = getSupabase();
    const { data, error } = await sb.from('promoteurs').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data;
}

async function fetchTestPromoteur() {
    const sb = getSupabase();
    const { data, error } = await sb.from('promoteurs').select('*').eq('is_test', true).limit(1).maybeSingle();
    if (error) throw error;
    return data;
}

async function fetchPromoteurStats() {
    const sb = getSupabase();
    const { data, error } = await sb.from('promoteurs').select('has_phone, has_email, contact_type');
    if (error) throw error;
    const rows = data || [];
    return {
        total: rows.length,
        withPhone: rows.filter((r) => r.has_phone).length,
        withEmail: rows.filter((r) => r.has_email).length,
        both: rows.filter((r) => r.contact_type === 'both').length,
        phoneOnly: rows.filter((r) => r.contact_type === 'phone_only').length,
        emailOnly: rows.filter((r) => r.contact_type === 'email_only').length,
        none: rows.filter((r) => r.contact_type === 'none').length,
    };
}

async function fetchPromoteursForBroadcast(channel = 'email') {
    const sb = getSupabase();
    let query = sb.from('promoteurs').select('*').order('nom', { ascending: true });
    if (channel === 'email') {
        query = query.eq('has_email', true);
    } else if (channel === 'whatsapp' || channel === 'phone') {
        query = query.eq('has_phone', true);
    }
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
}

async function fetchPromoteursWithPhone(limit = 10) {
    const sb = getSupabase();
    const { data, error } = await sb
        .from('promoteurs')
        .select('nom, telephone, email')
        .eq('has_phone', true)
        .order('nom')
        .limit(limit);
    if (error) throw error;
    return data || [];
}

async function fetchPromoteursWithEmail(limit = 10) {
    const sb = getSupabase();
    const { data, error } = await sb
        .from('promoteurs')
        .select('nom, email, telephone')
        .eq('has_email', true)
        .order('nom')
        .limit(limit);
    if (error) throw error;
    return data || [];
}

async function fetchBoxeurs({ search = '', contactType = '', categorie = '' } = {}) {
    const sb = getSupabase();
    let query = sb.from('boxeurs').select('*').order('nom', { ascending: true });

    if (search) {
        query = query.ilike('nom', `%${search}%`);
    }
    if (contactType && contactType !== 'all') {
        query = query.eq('contact_type', contactType);
    }
    if (categorie) {
        query = query.eq('categorie', categorie);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
}

async function fetchBoxeurById(id) {
    const sb = getSupabase();
    const { data, error } = await sb.from('boxeurs').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data;
}

async function fetchTestBoxeur() {
    const sb = getSupabase();
    const { data, error } = await sb.from('boxeurs').select('*').eq('is_test', true).limit(1).maybeSingle();
    if (error) throw error;
    return data;
}

async function fetchBoxeurStats() {
    const sb = getSupabase();
    const { data, error } = await sb.from('boxeurs').select('has_phone, has_email, contact_type, categorie');
    if (error) throw error;
    const rows = data || [];
    return {
        total: rows.length,
        amateur: rows.filter((r) => r.categorie === 'amateur').length,
        pro: rows.filter((r) => r.categorie === 'pro').length,
        withPhone: rows.filter((r) => r.has_phone).length,
        withEmail: rows.filter((r) => r.has_email).length,
        both: rows.filter((r) => r.contact_type === 'both').length,
        phoneOnly: rows.filter((r) => r.contact_type === 'phone_only').length,
        emailOnly: rows.filter((r) => r.contact_type === 'email_only').length,
        none: rows.filter((r) => r.contact_type === 'none').length,
    };
}

async function fetchBoxeursForBroadcast(channel = 'email', categorie = '') {
    const sb = getSupabase();
    let query = sb.from('boxeurs').select('*').order('nom', { ascending: true });
    if (channel === 'email') {
        query = query.eq('has_email', true);
    } else if (channel === 'whatsapp' || channel === 'phone') {
        query = query.eq('has_phone', true);
    }
    if (categorie) {
        query = query.eq('categorie', categorie);
    }
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
}

async function fetchBoxeursWithPhone(limit = 10, categorie = '') {
    const sb = getSupabase();
    let query = sb
        .from('boxeurs')
        .select('nom, telephone, email, categorie')
        .eq('has_phone', true)
        .order('nom')
        .limit(limit);
    if (categorie) {
        query = query.eq('categorie', categorie);
    }
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
}

async function fetchBoxeursWithEmail(limit = 10, categorie = '') {
    const sb = getSupabase();
    let query = sb
        .from('boxeurs')
        .select('nom, email, telephone, categorie')
        .eq('has_email', true)
        .order('nom')
        .limit(limit);
    if (categorie) {
        query = query.eq('categorie', categorie);
    }
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
}

async function fetchManagersWithEmail(limit = 10) {
    const sb = getSupabase();
    const { data, error } = await sb
        .from('managers')
        .select('nom, email, telephone')
        .eq('has_email', true)
        .order('nom')
        .limit(limit);
    if (error) throw error;
    return data || [];
}

async function fetchClientsByIds(ids) {
    if (!ids?.length) return [];
    const sb = getSupabase();
    const { data, error } = await sb
        .from('portet_clients')
        .select('id, prenom, nom, telephone, email, salle')
        .in('id', ids);
    if (error) throw error;
    return data || [];
}

/** Compte rapide pour répondre à Vercel avant chargement complet (17k+ lignes). */
async function countPortetClientsForBroadcast(broadcast) {
    const sb = getSupabase();
    let query = sb.from('portet_clients').select('id', { count: 'exact', head: true });
    if (broadcast === 'email') {
        query = query.not('email', 'is', null).neq('email', '');
    } else if (broadcast === 'phone' || broadcast === 'whatsapp') {
        query = query.not('telephone', 'is', null).neq('telephone', '');
    }
    const { count, error } = await query;
    if (error) throw error;
    return count ?? 0;
}

async function fetchClientById(id) {
    const sb = getSupabase();
    const { data, error } = await sb.from('portet_clients').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data;
}

function clientDisplayName(client) {
    if (!client) return 'Client';
    const full = [client.prenom, client.nom].filter(Boolean).join(' ').trim();
    return full || client.email || client.telephone || 'Client';
}

async function fetchUnreadInbound() {
    const sb = getSupabase();
    const { data, error } = await sb
        .from('inbound_messages')
        .select('*')
        .eq('is_read', false)
        .order('received_at', { ascending: false })
        .limit(20);
    if (error) throw error;
    return data || [];
}

async function fetchInboundMessages({ unreadOnly = false, limit = 50 } = {}) {
    const sb = getSupabase();
    let query = sb.from('inbound_messages').select('*').order('received_at', { ascending: false }).limit(limit);
    if (unreadOnly) query = query.eq('is_read', false);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
}

async function fetchOutboundMessages(limit = 50) {
    const sb = getSupabase();
    const { data, error } = await sb
        .from('outbound_messages')
        .select('*, managers(nom)')
        .order('created_at', { ascending: false })
        .limit(limit);
    if (error) throw error;
    return data || [];
}

async function saveInboundMessage({ fromPhone, fromName, body }) {
    const sb = getSupabase();
    const { data, error } = await sb
        .from('inbound_messages')
        .insert({
            from_phone: fromPhone,
            from_name: fromName || null,
            body,
            is_read: false,
        })
        .select()
        .single();
    if (error) throw error;
    return data;
}

async function markInboundRead(ids) {
    if (!ids?.length) return;
    const sb = getSupabase();
    const { error } = await sb.from('inbound_messages').update({ is_read: true }).in('id', ids);
    if (error) throw error;
}

async function createOutboundMessage(payload) {
    const sb = getSupabase();
    const { data, error } = await sb.from('outbound_messages').insert(payload).select().single();
    if (error) throw error;
    return data;
}

async function updateOutboundMessage(id, patch) {
    const sb = getSupabase();
    const { data, error } = await sb.from('outbound_messages').update(patch).eq('id', id).select().single();
    if (error) throw error;
    return data;
}

/** Accusé de lecture WhatsApp (messages.update status READ). */
async function markOutboundWhatsAppRead(waMessageId) {
    if (!waMessageId) return null;
    const sb = getSupabase();
    const now = new Date().toISOString();
    const { data, error } = await sb
        .from('outbound_messages')
        .update({ read_at: now })
        .eq('wa_message_id', String(waMessageId))
        .is('read_at', null)
        .select('id, campaign, client_id, recipient')
        .maybeSingle();
    if (error) throw error;
    return data;
}

module.exports = {
    getSupabase,
    fetchAllPaginated,
    fetchManagers,
    fetchManagerById,
    fetchTestManager,
    fetchManagerStats,
    fetchManagersWithPhone,
    fetchManagersWithEmail,
    fetchManagersForBroadcast,
    fetchPromoteurs,
    fetchPromoteurById,
    fetchTestPromoteur,
    fetchPromoteurStats,
    fetchPromoteursForBroadcast,
    fetchPromoteursWithPhone,
    fetchPromoteursWithEmail,
    fetchBoxeurs,
    fetchBoxeurById,
    fetchTestBoxeur,
    fetchBoxeurStats,
    fetchBoxeursForBroadcast,
    fetchBoxeursWithPhone,
    fetchBoxeursWithEmail,
    fetchClientById,
    fetchClientsByIds,
    countPortetClientsForBroadcast,
    clientDisplayName,
    fetchUnreadInbound,
    fetchInboundMessages,
    fetchOutboundMessages,
    saveInboundMessage,
    markInboundRead,
    createOutboundMessage,
    updateOutboundMessage,
    markOutboundWhatsAppRead,
};
