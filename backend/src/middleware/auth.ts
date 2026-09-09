import type { Request, Response, NextFunction, RequestHandler } from 'express';
import jwt, { type JwtPayload as JwtLibPayload, type SignOptions } from 'jsonwebtoken';
import type { JwtPayload, UserRole } from '../types';

export interface AuthenticatedUser {
  id: number;
  email: string;
  role: UserRole;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not defined in environment');
  }
  return secret;
}

export function signAuthToken(
  user: AuthenticatedUser,
  expiresIn?: SignOptions['expiresIn'],
): string {
  const payload: JwtPayload = {
    id: user.id,
    email: user.email,
    role: user.role,
  };
  // `expiresIn` est optionnel dans SignOptions mais n'accepte pas `undefined`
  // sous exactOptionalPropertyTypes : on résout la valeur avant de construire
  // l'objet, au lieu d'y placer un éventuel undefined.
  const ttl: NonNullable<SignOptions['expiresIn']> =
    expiresIn ?? ((process.env.JWT_EXPIRES_IN ?? '12h') as NonNullable<SignOptions['expiresIn']>);
  const options: SignOptions = { expiresIn: ttl };
  return jwt.sign(payload, getJwtSecret(), options);
}

export const authenticate: RequestHandler = (req, res, next) => {
  const header = req.header('Authorization');
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing bearer token' });
  }

  const token = header.slice('Bearer '.length).trim();
  if (!token) {
    return res.status(401).json({ error: 'Empty bearer token' });
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret()) as JwtPayload & JwtLibPayload;
    if (typeof decoded.id !== 'number' || !decoded.email || !decoded.role) {
      return res.status(401).json({ error: 'Malformed token payload' });
    }
    req.user = { id: decoded.id, email: decoded.email, role: decoded.role };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

/**
 * Renseigne `req.user` si un bearer valide est présent, sans jamais rejeter.
 * Pour les routes accessibles aux deux publics — par exemple l'activation d'un
 * compte, où l'appelant ne peut pas encore se connecter.
 */
export const authenticateOptional: RequestHandler = (req, _res, next) => {
  const header = req.header('Authorization');
  if (!header || !header.startsWith('Bearer ')) return next();

  const token = header.slice('Bearer '.length).trim();
  if (!token) return next();

  try {
    const decoded = jwt.verify(token, getJwtSecret()) as JwtPayload & JwtLibPayload;
    if (typeof decoded.id === 'number' && decoded.email && decoded.role) {
      req.user = { id: decoded.id, email: decoded.email, role: decoded.role };
    }
  } catch {
    // Jeton invalide : on poursuit en anonyme, la route décidera.
  }
  next();
};

export function requireRole(...allowed: UserRole[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthenticated' });
    }
    if (!allowed.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

// Raccourcis pour lisibilité côté routes.
export const requireManager = requireRole('manager', 'admin');
export const requireAccounting = requireRole('accounting', 'admin');
export const requireHR = requireRole('hr', 'admin');
export const requireAdmin = requireRole('admin');

/**
 * Restreint l'accès à la ressource au propriétaire (userId param/body)
 * OU à un rôle privilégié (manager/hr/accounting/admin).
 */
export function requireSelfOrRole(
  extractOwnerId: (req: Request) => number | undefined,
  ...privilegedRoles: UserRole[]
): RequestHandler {
  const privileged = new Set<UserRole>(
    privilegedRoles.length > 0 ? privilegedRoles : ['admin'],
  );
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
    const ownerId = extractOwnerId(req);
    if (ownerId !== undefined && ownerId === req.user.id) return next();
    if (privileged.has(req.user.role)) return next();
    return res.status(403).json({ error: 'Insufficient permissions' });
  };
}
