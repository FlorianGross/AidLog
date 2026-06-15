/**
 * Public surface of the supervisors feature — fetch + cache the org's active
 * supervisor (admin + lead) PUBLIC identities so NEW records can be additionally
 * sealed to them (recipientType 'supervisor'), enabling per-deployment
 * statistics for leads/admins without the org password.
 */
export {
  loadSupervisors,
  getCachedSupervisors,
  clearSupervisorCache,
  type SupervisorRecipient,
} from './store';
