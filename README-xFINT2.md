# xFINT2 — Gestion des Congés et Absences

Application web de demande et de validation des congés. Un salarié pose ses
dates, le serveur calcule les jours ouvrés et réserve le solde, le manager
valide, la RH confirme. Un calendrier d'équipe et un écran d'administration RH
complètent l'ensemble.

Le projet partage sa base de données, son authentification et son interface avec
[xFINT1 — Notes de frais](./README-xFINT1.md). Les deux modules s'installent et
se lancent ensemble.

---

## 1. Installation

### Prérequis

- Node.js 20 ou supérieur (développé et testé sous Node 24.14, npm 11.11)
- PostgreSQL 15 ou supérieur, en local ou via Docker
- Git

### Récupérer les dépendances

```bash
git clone <url-du-dépôt> sup-herman-projects
cd sup-herman-projects

cd backend  && npm install
cd ../frontend && npm install
```

### Base de données

Le projet n'embarque pas de fichier `docker-compose.yml`. Pour lancer un
PostgreSQL jetable :

```bash
docker run -d --name supherman-db \
  -e POSTGRES_PASSWORD=<mot-de-passe> \
  -e POSTGRES_DB=supherman \
  -p 5432:5432 \
  postgres:15
```

Aucune commande de migration à jouer à la main : au premier démarrage, le
serveur applique `backend/src/database/schema.sql` si la base est vierge, puis
rejoue les migrations de `backend/src/database/migrations/`. Elles sont écrites
idempotentes et se rejouent sans dommage sur une base déjà en service.

Les six types de congé sont insérés par le schéma : congés payés (25 j), RTT
(10 j), arrêt maladie, événement familial, congé sans solde et formation. Les
quatre derniers sont sans dotation : ils sont décomptés, jamais bloquants.

---

## 2. Configuration

### `backend/.env`

| Variable | Obligatoire | Défaut | Rôle |
|---|---|---|---|
| `DATABASE_URL` | oui | — | Chaîne de connexion PostgreSQL |
| `JWT_SECRET` | oui | — | Clé de signature des jetons. Le serveur refuse de démarrer sans elle |
| `JWT_EXPIRES_IN` | non | `12h` | Durée de vie d'un jeton |
| `PORT` | non | `3000` | Port d'écoute de l'API |
| `CORS_ORIGIN` | non | `http://localhost:5173` | Origine autorisée pour le front |

Exemple :

```ini
DATABASE_URL=postgresql://postgres:<mot-de-passe>@localhost:5432/supherman
JWT_SECRET=<chaîne-aléatoire-longue>
JWT_EXPIRES_IN=12h
PORT=3000
CORS_ORIGIN=http://localhost:5173
```

### `frontend/.env`

| Variable | Défaut | Rôle |
|---|---|---|
| `VITE_API_URL` | `http://localhost:3000` | URL de base de l'API |

Inutile si le backend tourne sur le port par défaut.

### Jours fériés

Ils ne sont pas stockés en base : les onze jours fériés légaux de France
métropolitaine sont calculés, dont les trois mobiles déduits de la date de
Pâques. Rien à alimenter chaque année. L'Alsace-Moselle et ses deux jours
supplémentaires ne sont pas gérés.

---

## 3. Lancer le projet

```bash
# Terminal 1 — API sur http://localhost:3000
cd backend
npm run dev

# Terminal 2 — interface sur http://localhost:5173
cd frontend
npm run dev
```

Une fois le backend démarré au moins une fois, créer les comptes de
démonstration :

```bash
cd backend
npm run seed
```

### Scripts disponibles

| Emplacement | Commande | Effet |
|---|---|---|
| `backend` | `npm run dev` | API en rechargement à chaud (tsx watch) |
| `backend` | `npm run build` | Compilation TypeScript vers `dist/` |
| `backend` | `npm start` | Lance `dist/index.js` |
| `backend` | `npm run seed` | Crée les comptes de démonstration |
| `frontend` | `npm run dev` | Serveur de développement Vite |
| `frontend` | `npm run build` | Vérification des types puis build de production |
| `frontend` | `npm run preview` | Sert le build de production |
| `frontend` | `npm run lint` | oxlint |

Point de contrôle : `curl http://localhost:3000/health`.

---

## 4. Comptes de test

Créés par `npm run seed` :

| Email | Mot de passe | Rôle |
|---|---|---|
| `manager@supherman.com` | `Suph3rm4n!` | Manager |
| `employee@supherman.com` | `Test123!` | Salarié |
| `hr@supherman.com` | `Test123!` | RH |
| `accounting@supherman.com` | `Test123!` | Comptabilité |

Pour dérouler un circuit complet, il faut les trois premiers : le salarié
demande, le manager valide, la RH confirme. Identifiants réservés au
développement et à la démonstration.

---

## 5. Manuel utilisateur

### Le circuit d'une demande

```
    Salarié            Manager                RH
   ┌────────┐        ┌───────────┐       ┌───────────┐
   │ demande│──────▶│ validation │─────▶│ validation │
   └────────┘        └───────────┘       └───────────┘
   submitted       approved_manager       approved_hr
        │                 │                    │
        │                 └──── refus ─────────┘
        │                          ▼
        │                       rejected
        └──── annulation ──────▶ cancelled
```

Le demandeur peut annuler sa demande à tout moment tant qu'elle n'est pas close,
y compris après validation RH : les jours lui sont alors restitués. Personne ne
valide sa propre demande.

### Le décompte des jours

Le nombre de jours est **calculé par le serveur**, jamais transmis par le
client : ce sont les jours ouvrés entre les deux dates, bornes incluses,
week-ends et jours fériés déduits. Une période qui ne contient aucun jour ouvré
est refusée.

Le solde suit trois compteurs par type et par année :

- **alloué** — la dotation, éditable par la RH ;
- **en attente** — réservé dès la demande, libéré en cas de refus ou
  d'annulation ;
- **pris** — consommé à la validation RH.

Le solde restant vaut `alloué − pris − en attente`. Seuls les types dotés
(congés payés, RTT) bloquent une demande qui dépasse le solde. Maladie, congé
sans solde et formation sont décomptés mais jamais bloquants. Une demande à
cheval sur le 31 décembre est imputée en entier sur l'année de début.

### Salarié

- **Tableau de bord** (`/leaves`) — les soldes par type sous forme de jauges,
  les demandes en cours de validation, les congés validés à venir.
- **Mes demandes** (`/leaves/list`) — l'historique complet : type, dates, jours,
  statut. Un clic ouvre le détail.
- **Demander un congé** (`/leaves/new`) — type, date de début, date de fin,
  motif, justificatif.
  - Le nombre de jours décomptés, le solde du type choisi et le solde après
    demande s'affichent en direct pendant la saisie, avec le détail jour par
    jour.
  - Trois contrôles bloquants signalés avant l'envoi : date de fin antérieure au
    début, période sans jour ouvré, chevauchement avec une demande existante.
    Le serveur les revérifie tous.
  - Justificatif attendu pour maladie, formation et événement familial. Formats
    acceptés : JPEG, PNG, WebP, HEIC, PDF, 10 Mo par fichier, 10 fichiers.
- **Calendrier** (`/leaves/calendar`) — vue mensuelle de l'équipe, une couleur
  par type de congé. Seuls les congés définitivement validés y figurent. Un
  sélecteur permet de n'afficher que les siens.
- **Détail d'une demande** — statut, période, jours, motif, commentaires du
  manager et de la RH, justificatifs, et le bouton d'annulation.

### Manager

Tout ce qui précède, plus :

- **À valider** (`/leaves/approvals`) — toutes les demandes, avec filtres par
  salarié, par statut et par type. Le filtre « À traiter par moi », actif par
  défaut, ne laisse que les demandes en attente de sa décision et masque les
  siennes.
- Dans le détail : **Approuver (manager)** ou **Refuser**, avec un commentaire
  facultatif. Sa validation ne consomme pas encore le solde : elle passe la
  demande à l'étape RH.

### RH

Le même écran de validation, positionné sur la seconde étape : la RH approuve
les demandes déjà validées par un manager. C'est cette validation qui bascule
les jours de « en attente » vers « pris ».

- **RH — Soldes & utilisateurs** (`/leaves/hr`) — l'annuaire complet : email,
  rôle, manager de rattachement, état du compte, soldes CP et RTT.
  - **Bascule Actif** directement dans le tableau. Un compte désactivé ne peut
    plus se connecter. La RH ne peut pas désactiver son propre compte.
  - **Clic sur une ligne** — fiche complète : prénom, nom, email, rôle, manager
    de rattachement, activation.
  - **Soldes** — la dotation d'un type pour l'année en cours. Elle ne peut pas
    descendre sous les jours déjà pris ou en attente. Les compteurs « pris » et
    « en attente » se déduisent des demandes et ne s'éditent pas.
  - **Mot de passe** — définit un mot de passe provisoire, à transmettre par un
    autre canal. Aucun email n'est envoyé par l'application.

### Première connexion

Un compte créé par un manager n'a pas de mot de passe et ne peut donc pas se
connecter. Le manager reçoit un lien d'activation, affiché **une seule fois** à
la création et valable 7 jours, que le salarié ouvre pour choisir son mot de
passe (`/set-password`).

Si le lien est perdu ou expiré, la RH définit un mot de passe provisoire depuis
l'écran RH. Tout utilisateur connecté peut ensuite changer le sien depuis
**Changer mon mot de passe**, en fournissant l'actuel.

---

## 6. API

Base : `http://localhost:3000`. Toutes les routes `/api/leaves` et, sauf
exception signalée, `/api/users` exigent un en-tête
`Authorization: Bearer <jeton>`.

### Congés

| Méthode | Route | Accès | Description |
|---|---|---|---|
| `GET` | `/api/leaves/mine` | connecté | Ses propres demandes |
| `GET` | `/api/leaves/all` | manager, RH, admin | Toutes les demandes |
| `POST` | `/api/leaves` | connecté | Création, statut `submitted` d'emblée |
| `GET` | `/api/leaves/:id` | propriétaire ou rôle valideur | Détail + justificatifs |
| `PATCH` | `/api/leaves/:id/status` | valideurs ; annulation aussi au demandeur | Décision |
| `GET` | `/api/leaves/balance/:user_id` | soi-même ou rôle valideur | Soldes par type |
| `PATCH` | `/api/leaves/balance/:user_id` | RH, admin | Ajuste une dotation |
| `POST` | `/api/leaves/:id/attachments` | propriétaire, RH, admin | Envoi multipart, champ `files` |
| `GET` | `/api/leaves/:id/attachments/:aid` | propriétaire ou rôle valideur | Téléchargement |
| `DELETE` | `/api/leaves/:id/attachments/:aid` | propriétaire, RH, admin | Suppression |

**`POST /api/leaves`**

```json
{
  "type": "PAID",
  "date_start": "2026-09-14",
  "date_end": "2026-09-18",
  "comment": "Vacances en famille"
}
```

Le type se désigne par son code (`PAID`, `RTT`, `SICK`, `FAMILY`, `UNPAID`,
`TRAINING`) ou par `leave_type_id`. Les jours sont calculés par le serveur.

**`PATCH /api/leaves/:id/status`**

```json
{ "status": "approved", "comment": "Bonnes vacances" }
```

`status` vaut `approved`, `rejected` ou `cancelled`. Comme pour les notes de
frais, le statut réel dépend du rôle et de l'étape : un `approved` posé par un
manager donne `approved_manager`, le même posé par la RH donne `approved_hr`.

**`PATCH /api/leaves/balance/:user_id`**

```json
{ "type": "RTT", "year": 2026, "allocated_days": 12 }
```

`year` est facultatif et vaut l'année en cours par défaut. Seule
`allocated_days` est modifiable.

### Utilisateurs

| Méthode | Route | Accès | Description |
|---|---|---|---|
| `GET` | `/api/users` | RH, admin | Annuaire avec état d'activation et soldes |
| `POST` | `/api/users` | manager, admin | Crée un compte, renvoie le jeton d'activation |
| `PATCH` | `/api/users/:id` | RH, admin | Identité, email, rôle, rattachement, activation |
| `PATCH` | `/api/users/:id/password` | trois modes, voir ci-dessous | Définit un mot de passe |

**`PATCH /api/users/:id/password`** accepte trois formes :

| Corps | Appelant | Usage |
|---|---|---|
| `{ token, password }` | non connecté | Activation d'un compte, avec le jeton du lien |
| `{ current_password, password }` | l'intéressé | Changement de son propre mot de passe |
| `{ password }` | RH, admin | Mot de passe provisoire pour un autre compte |

Le mot de passe fait 8 caractères minimum. Le jeton d'activation est à usage
unique et expire au bout de 7 jours.

**`PATCH /api/users/:id`** — tous les champs sont facultatifs, un champ absent
reste inchangé. `manager_id: null` détache le salarié de son manager.
L'auto-rattachement et l'auto-désactivation sont refusés en `400`.

### Codes de retour

| Code | Signification |
|---|---|
| `400` | Payload invalide, période sans jour ouvré, dates incohérentes, manager inconnu |
| `401` | Jeton absent, invalide ou expiré |
| `403` | Rôle insuffisant, jeton d'activation invalide, validation de sa propre demande |
| `404` | Ressource inexistante |
| `409` | Chevauchement de périodes, solde insuffisant, transition impossible, email déjà pris |

Le corps d'erreur est toujours `{ "error": "..." }`, avec un `details`
complémentaire sur les erreurs de validation.

---

## 7. Architecture

### Organisation

```
backend/
  src/
    index.ts                amorçage Express, schéma et migrations au démarrage
    db.ts                   pool PostgreSQL
    database/
      schema.sql            schéma complet
      migrations/           001 comptes sans mot de passe
                            002 circuit congés à deux étapes
                            003 justificatifs et jetons d'activation
    middleware/auth.ts      jeton obligatoire ou optionnel, garde-fous par rôle
    routes/leaves.ts        xFINT2
    routes/users.ts         annuaire et comptes
    lib/businessDays.ts     jours ouvrés et jours fériés
    lib/uploads.ts          configuration multer partagée
  uploads/                  justificatifs (hors dépôt)

frontend/
  src/
    businessDays.ts         miroir du module serveur, pour l'affichage en direct
    leaveLabels.ts          libellés, couleurs par type, formatage
    components/LeaveDetailModal.tsx
    pages/xfint2/           tableau de bord, liste, demande, validation,
                            calendrier, écran RH, définition du mot de passe
```

### Schéma de données

```
users ──┬──< leave_requests ──< leave_attachments
        │         (user_id)         (leave_request_id)
        ├──< leave_balances
        └──< expense_notes                → voir xFINT1

leave_types ──┬──< leave_requests
              └──< leave_balances
```

- **`leave_requests`** porte deux jeux de colonnes de décision, un par étape :
  `manager_id` / `manager_comment` / `manager_action_at` et `hr_id` /
  `hr_comment` / `hr_action_at`. La route d'écriture choisit le jeu selon le
  rôle, ce qui conserve les deux décisions.
- **`leave_balances`** est unique par `(user_id, leave_type_id, year)`. La ligne
  est créée à la volée à partir de `leave_types.default_annual_days` au premier
  besoin.
- **`leave_attachments`** double la table `attachments` de xFINT1, qui est liée
  aux notes de frais par une colonne obligatoire et ne peut pas porter les
  justificatifs de congé. Même convention : seul le nom généré côté serveur est
  stocké, jamais exposé, et le chemin est renormalisé avant lecture.
- Les colonnes `NUMERIC` (`days_requested`, `allocated_days`…) sont sérialisées
  en chaîne par PostgreSQL sur les lignes de demande. Le endpoint de solde, lui,
  renvoie des nombres : les types TypeScript reflètent cette différence des deux
  côtés.

### Cohérence des soldes

Toute opération qui touche un solde — création, validation, refus, annulation,
ajustement RH — s'exécute dans une transaction, avec un `SELECT … FOR UPDATE`
sur la ligne de solde. Deux décisions simultanées sur le même salarié ne peuvent
pas se marcher dessus, et l'écart entre le contrôle de solde et l'écriture ne
laisse pas de fenêtre.

### Calcul des jours ouvrés

`lib/businessDays.ts` raisonne en UTC sur des chaînes `YYYY-MM-DD` : construire
une date locale décalerait le jour selon le fuseau et ferait basculer un lundi
en dimanche. La date de Pâques suit l'algorithme de Meeus/Jones/Butcher, d'où se
déduisent le lundi de Pâques, l'Ascension et le lundi de Pentecôte.

Le module est **dupliqué à l'identique côté frontend** (`src/businessDays.ts`)
pour afficher le décompte pendant la saisie. Le serveur reste la source de
vérité — il recalcule systématiquement à la création. Toute correction doit être
reportée des deux côtés.

### Authentification

Identique à xFINT1 : bcrypt (coût 12), JWT contenant `{ id, email, role }` signé
avec le secret partagé (HS256, l'algorithme par défaut de `jsonwebtoken`),
jeton en `localStorage`, `authenticate` puis `requireRole(...)` côté serveur,
`ProtectedRoute` côté interface.

Une variante existe pour l'activation de compte : `authenticateOptional`
renseigne l'utilisateur si un jeton valide accompagne la requête, sans jamais
rejeter. Elle sert `PATCH /api/users/:id/password`, qui doit rester joignable
par quelqu'un qui, par construction, ne peut pas encore se connecter. Le jeton
d'activation n'est jamais stocké en clair : la base n'en garde qu'une empreinte
SHA-256, comparée à durée constante.

### Rôles

| Rôle | Périmètre xFINT2 |
|---|---|
| `employee` | Ses demandes, ses soldes, le calendrier d'équipe |
| `manager` | Idem, plus la première étape de validation |
| `hr` | Idem, plus la seconde étape, l'annuaire, les soldes et les mots de passe |
| `accounting` | Ses demandes uniquement (voir xFINT1 pour ses attributions) |
| `admin` | Accès complet, avance d'une étape à la fois dans le circuit |
