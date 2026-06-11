/** Comptes console web — super admin + utilisateurs créés. */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const USERS_FILE = path.join(__dirname, 'users.json');
const SALT_ROUNDS = 10;

function loadUsersFile() {
    if (!fs.existsSync(USERS_FILE)) {
        return { users: [] };
    }
    try {
        return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    } catch {
        return { users: [] };
    }
}

function saveUsersFile(data) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function seedSuperAdmin() {
    const email = normalizeEmail(process.env.SUPER_ADMIN_EMAIL);
    const password = process.env.SUPER_ADMIN_PASSWORD || '';
    if (!email || !password) return;

    const data = loadUsersFile();
    const exists = data.users.some((u) => normalizeEmail(u.email) === email);
    if (exists) return;

    data.users.push({
        email,
        passwordHash: bcrypt.hashSync(password, SALT_ROUNDS),
        role: 'super_admin',
        name: 'Super Admin',
        createdAt: new Date().toISOString(),
    });
    saveUsersFile(data);
    console.log(`[AUTH] Super admin initialisé : ${email}`);
}

function listUsers() {
    return loadUsersFile().users.map((u) => ({
        email: u.email,
        role: u.role,
        name: u.name || '',
        createdAt: u.createdAt || null,
    }));
}

function findUser(email) {
    const key = normalizeEmail(email);
    return loadUsersFile().users.find((u) => normalizeEmail(u.email) === key) || null;
}

function verifyUser(email, password) {
    const user = findUser(email);
    if (!user || !password) return null;
    if (!bcrypt.compareSync(password, user.passwordHash)) return null;
    return {
        email: user.email,
        role: user.role,
        name: user.name || user.email,
    };
}

function createUser({ email, password, role = 'admin', name = '' }, actorRole) {
    if (actorRole !== 'super_admin') {
        throw new Error('Seul le super admin peut créer des comptes');
    }
    const normalized = normalizeEmail(email);
    if (!normalized || !normalized.includes('@')) {
        throw new Error('Email invalide');
    }
    if (!password || password.length < 8) {
        throw new Error('Mot de passe minimum 8 caractères');
    }
    if (!['admin', 'super_admin'].includes(role)) {
        throw new Error('Rôle invalide (admin ou super_admin)');
    }

    const data = loadUsersFile();
    if (data.users.some((u) => normalizeEmail(u.email) === normalized)) {
        throw new Error('Cet email existe déjà');
    }

    data.users.push({
        email: normalized,
        passwordHash: bcrypt.hashSync(password, SALT_ROUNDS),
        role,
        name: name.trim(),
        createdAt: new Date().toISOString(),
    });
    saveUsersFile(data);
    return { email: normalized, role, name: name.trim() };
}

function deleteUser(email, actorEmail, actorRole) {
    if (actorRole !== 'super_admin') {
        throw new Error('Seul le super admin peut supprimer des comptes');
    }
    const target = normalizeEmail(email);
    const actor = normalizeEmail(actorEmail);
    if (target === actor) {
        throw new Error('Vous ne pouvez pas supprimer votre propre compte');
    }

    const data = loadUsersFile();
    const before = data.users.length;
    data.users = data.users.filter((u) => normalizeEmail(u.email) !== target);
    if (data.users.length === before) {
        throw new Error('Utilisateur introuvable');
    }
    saveUsersFile(data);
    return { deleted: target };
}

seedSuperAdmin();

module.exports = {
    verifyUser,
    listUsers,
    createUser,
    deleteUser,
    findUser,
    seedSuperAdmin,
};
