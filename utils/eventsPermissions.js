const ALLOWED_EXCHANGE_ROLES = new Set(["super_admin", "event_admin"]);

const SUPER_ADMIN_PERMISSIONS = [
  "events.organizations.read",
  "events.organizations.write",
  "events.activities.read",
  "events.activities.write",
  "events.registrations.read",
  "events.registrations.write",
  "events.users.read",
  "events.finance.read",
  "events.reviews.manage"
];

const EVENT_ADMIN_PERMISSIONS = [
  "events.organizations.read",
  "events.organizations.write",
  "events.activities.read",
  "events.activities.write",
  "events.registrations.read",
  "events.registrations.write"
];

/**
 * Map life-design admin role to events permission codes.
 * @param {string} role
 * @returns {string[]|null} null if role is not allowed
 */
function mapRoleToPermissions(role) {
  if (role === "super_admin") return [...SUPER_ADMIN_PERMISSIONS];
  if (role === "event_admin") return [...EVENT_ADMIN_PERMISSIONS];
  return null;
}

function isAllowedExchangeRole(role) {
  return ALLOWED_EXCHANGE_ROLES.has(role);
}

function isWritePermission(code) {
  return typeof code === "string" && (code.endsWith(".write") || code.endsWith(".manage"));
}

module.exports = {
  ALLOWED_EXCHANGE_ROLES,
  SUPER_ADMIN_PERMISSIONS,
  EVENT_ADMIN_PERMISSIONS,
  mapRoleToPermissions,
  isAllowedExchangeRole,
  isWritePermission
};
