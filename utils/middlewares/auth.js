/**
 * Auth middleware
 * Extracts user from headers (X-User-Email, X-User-Role, etc.)
 */

function getReqUser(req) {
  return {
    email: (req.get('X-User-Email') || '').trim().toLowerCase(),
    role: req.get('X-User-Role') || '',
    franchiseId: req.get('X-User-Franchise-Id') ? parseInt(req.get('X-User-Franchise-Id'), 10) : null,
    driverId: req.get('X-User-Driver-Id') ? parseInt(req.get('X-User-Driver-Id'), 10) : null,
  };
}

/** Require driver role */
function requireDriver(req, res, next) {
  const user = getReqUser(req);
  if (user.role !== 'driver' || !user.driverId) {
    return res.status(403).json({ error: 'Driver access required' });
  }
  req.user = user;
  next();
}

/** Require admin or master */
function requireAdmin(req, res, next) {
  const user = getReqUser(req);
  if (user.role !== 'admin' && user.role !== 'master') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  req.user = user;
  next();
}

module.exports = {
  getReqUser,
  requireDriver,
  requireAdmin,
};
