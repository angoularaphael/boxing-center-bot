const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

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

module.exports = {
    getSupabase,
    fetchManagers,
    fetchManagerById,
    fetchTestManager,
    fetchManagerStats,
    fetchManagersWithPhone,
    fetchManagersWithEmail,
    fetchManagersForBroadcast,
    fetchUnreadInbound,
    fetchInboundMessages,
    fetchOutboundMessages,
    saveInboundMessage,
    markInboundRead,
    createOutboundMessage,
    updateOutboundMessage,
};
