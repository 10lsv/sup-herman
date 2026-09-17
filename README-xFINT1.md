# xFINT1 — Gestion des Notes de Frais

Application web de saisie et de validation des notes de frais. Un salarié
déclare une dépense avec ses justificatifs, son manager la valide, la
comptabilité la contrôle puis la marque traitée (remboursée).

Le projet partage sa base de données, son authentification et son interface
avec [xFINT2 — Congés et absences](./README-xFINT2.md). Les deux modules
s'installent et se lancent ensemble.

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
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=supherman \
  -p 5432:5432 \
  postgres:15
```

Ces identifiants (`postgres` / `postgres`, base `supherman`) sont ceux de
`backend/.env.example` : avec cette commande, l'exemple fonctionne sans
retouche. Si le port 5432 est déjà pris, publier un autre port (`-p 5433:5432`)
et le reporter dans `DATABASE_URL`.

Aucune commande de migration à jouer à la main : au premier démarrage, le
serveur détecte que la table `users` est absente et applique
`backend/src/database/schema.sql`, puis rejoue les migrations de
`backend/src/database/migrations/` (elles sont idempotentes).

---

## 2. Configuration

### `backend/.env`

Le fichier n'est pas versionné. Le créer à partir de l'exemple fourni :

```bash
cp backend/.env.example backend/.env
```

| Variable | Obligatoire | Défaut | Rôle |
|---|---|---|---|
| `DATABASE_URL` | oui | — | Chaîne de connexion PostgreSQL |
| `JWT_SECRET` | oui | — | Clé de signature des jetons (voir ci-dessous) |
| `JWT_EXPIRES_IN` | non | `12h` | Durée de vie d'un jeton |
| `PORT` | non | `3000` | Port d'écoute de l'API |
| `CORS_ORIGIN` | non | `http://localhost:5173` | Origine autorisée pour le front |
| `NODE_ENV` | non | — | Présente dans l'exemple, sans effet sur le serveur actuellement |

Contenu de `backend/.env.example` :

```ini
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/supherman
JWT_SECRET=change-me-to-a-long-random-string
JWT_EXPIRES_IN=12h
NODE_ENV=development
PORT=3000
CORS_ORIGIN=http://localhost:5173
```

`JWT_SECRET` : la valeur de l'exemple suffit pour un essai local, mais doit être
remplacée ailleurs, par exemple par la sortie de `openssl rand -hex 32`.
Attention, le serveur **démarre même sans cette variable** : l'absence ne se
révèle qu'à la première connexion, qui échoue en `500` avec
`JWT_SECRET is not defined in environment`.

### `frontend/.env`

Une seule variable, optionnelle :

| Variable | Défaut | Rôle |
|---|---|---|
| `VITE_API_URL` | `http://localhost:3000` | URL de base de l'API |

Si le backend tourne sur le port par défaut, ce fichier est inutile.

### Stockage des justificatifs

Les fichiers sont écrits sur disque dans `backend/uploads/`, créé
automatiquement. Le nom sur disque est un UUID généré par le serveur ; le nom
d'origine est conservé en base. Rien à configurer.

---

## 3. Lancer le projet

Deux terminaux, qui restent ouverts :

```bash
# Terminal 1 — API sur http://localhost:3000
cd backend
npm run dev

# Terminal 2 — interface sur http://localhost:5173
cd frontend
npm run dev
```

Au premier démarrage sur une base vierge, le terminal 1 doit afficher :

```
[pg] connected
[schema] applying …/backend/src/database/schema.sql
[schema] applied successfully
[schema] migration 001_users_invite.sql applied
[schema] migration 002_leaves_workflow.sql applied
[schema] migration 003_leave_attachments_and_invites.sql applied
[http] listening on http://localhost:3000
```

Point de contrôle : `curl http://localhost:3000/health` répond
`{"ok":true,"uptime":…}`.

La base est alors vide : aucun compte n'existe. Dans un troisième terminal,
backend toujours lancé, créer les comptes de démonstration :

```bash
cd backend
npm run seed
```

Le seed affiche une ligne par compte. Il se relance sans risque : un compte
absent est créé, un compte présent retrouve le mot de passe et le rôle de la
section « Comptes de test » (le reste de sa fiche est conservé). Une base créée
avec l'ancien compte `hr@supherman.com` le voit renommé en `rh@supherman.com`.

Vérifier la connexion :

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"manager@supherman.com","password":"Suph3rm4n!"}'
```

La réponse contient `token` et `user`. Garder les **guillemets simples** : entre
guillemets doubles, bash et zsh interprètent le `!` du mot de passe.

### Scripts disponibles

| Emplacement | Commande | Effet |
|---|---|---|
| `backend` | `npm run dev` | API en rechargement à chaud (tsx watch) |
| `backend` | `npm run build` | Compilation TypeScript vers `dist/` |
| `backend` | `npm start` | Lance `dist/index.js` |
| `backend` | `npm run seed` | Crée les comptes de test, ou remet à niveau leur mot de passe et leur rôle |
| `frontend` | `npm run dev` | Serveur de développement Vite |
| `frontend` | `npm run build` | Vérification des types puis build de production |
| `frontend` | `npm run preview` | Sert le build de production |
| `frontend` | `npm run lint` | oxlint |

---

## 4. Comptes de test

Créés par `npm run seed` :

| Email | Mot de passe | Rôle |
|---|---|---|
| `manager@supherman.com` | `Suph3rm4n!` | Manager |
| `employee@supherman.com` | `Test123!` | Salarié |
| `accounting@supherman.com` | `Test123!` | Comptabilité |
| `rh@supherman.com` | `Suph3rm4n!` | RH |

Les trois derniers comptes sont rattachés au manager. Ces identifiants sont
destinés au développement et à la démonstration : ils n'ont pas leur place sur
un environnement exposé.

---

## 5. Manuel utilisateur

### Le circuit d'une note de frais

```
    Salarié            Manager            Comptabilité       Comptabilité
   ┌────────┐        ┌───────────┐       ┌──────────────┐   ┌────────────┐
   │ saisie │──────▶│ validation │─────▶│  validation   │──▶│ remboursée │
   └────────┘        └───────────┘       └──────────────┘   └────────────┘
   submitted       approved_manager    approved_accounting    reimbursed
                          │                    │
                          └──── refus ─────────┘
                                    ▼
                                 rejected
```

L'interface affiche les libellés du sujet, plus synthétiques que les statuts
internes :

| Libellé affiché | Statuts internes |
|---|---|
| Créée | `submitted` |
| Validée | `approved_manager`, `approved_accounting` — le badge est bleu après le manager, vert après la comptabilité |
| Refusée | `rejected` |
| Traitée | `reimbursed` |

Une note refusée ou traitée est close : plus aucune décision n'est possible
dessus. Personne ne peut valider sa propre note, quel que soit son rôle.

### Accueil

`/dashboard`, la page d'arrivée après connexion, également joignable par le nom
de l'application dans la barre du haut :

- **Notes de frais** — le nombre de notes par statut (Créée, Validée, Refusée,
  Traitée), les trois dernières, et les accès « Mes notes » et « + Nouvelle
  note ».
- **Congés** — les soldes de congés payés et de RTT restants, le nombre de
  demandes en attente de validation et le prochain congé validé (voir
  [xFINT2](./README-xFINT2.md)).
- **À traiter** (manager, comptabilité, RH) — le nombre de notes de frais et de
  congés qui attendent une décision de l'utilisateur, ses propres éléments
  exclus, avec un lien vers l'écran de validation.

Le menu latéral regroupe les écrans en deux sections, **Notes de frais** et
**Congés**, suivies de **Utilisateurs** (manager, RH) et **Mon profil**.

### Salarié

- **Mes notes** (`/expenses`) — la liste de ses notes, avec le statut
  courant. Un clic sur une ligne ouvre le détail.
- **Nouvelle note** (`/expenses/new`) — titre, commentaire, catégorie
  (Déplacement, Repas, Hébergement, Fournitures, Autre), montant, date de
  dépense, et les justificatifs.
  - Formats acceptés : JPEG, PNG, WebP, HEIC, PDF.
  - 10 Mo par fichier, 10 fichiers par envoi.
  - La note est créée directement en attente de validation : il n'y a pas
    d'étape brouillon.
  - Si l'envoi des justificatifs échoue, la note reste créée et le message
    l'indique — les fichiers peuvent être rajoutés depuis le détail.
- **Détail d'une note** — statut, montant, catégorie, commentaires de décision
  du manager et de la comptabilité, téléchargement des justificatifs.

### Manager

Tout ce qui précède, plus :

- **À valider** (`/expenses/approvals`) — toutes les notes de l'entreprise, avec
  le nom et l'email du salarié. Le filtre « À traiter uniquement », actif par
  défaut, ne laisse que les notes en attente de sa décision et masque les
  siennes propres.
- Dans le détail : **Valider** ou **Refuser**, avec un commentaire facultatif
  qui sera visible par le salarié.

Le manager dispose aussi de l'écran **Utilisateurs** (`/admin/users`), décrit
plus bas.

### Comptabilité

- **À valider** (`/expenses/approvals`) — même écran que celui du manager,
  filtré sur les étapes qui la concernent. L'ancienne adresse
  `/expenses/accounting` mène toujours au même écran.
- Dans le détail : **Valider** une note déjà validée par le manager, puis
  **Marquer traitée** une fois le virement effectué. Le refus reste possible
  tant que la note n'est pas traitée.

### Création de comptes (manager, RH)

**Utilisateurs** (`/admin/users`) — saisir un email et choisir un rôle parmi
ceux que le créateur peut attribuer : Salarié, Manager, Comptabilité pour un
manager ; Salarié, Manager, RH pour la RH. Le compte est créé **sans mot de passe** : l'écran affiche alors
un lien d'activation, avec un bouton pour le copier, à transmettre à
l'intéressé, qui y choisira son mot de passe.

La RH peut aussi créer un compte en choisissant son manager responsable depuis
l'écran **Gestion RH** : voir [xFINT2](./README-xFINT2.md#rh).

Ce lien n'est **affiché qu'une seule fois** — la base n'en conserve qu'une
empreinte — et expire au bout de 7 jours. S'il est perdu, la RH peut définir un
mot de passe provisoire depuis l'écran RH de xFINT2.

---

## 6. Documentation de l'API

Base : `http://localhost:3000`. Toutes les routes `/api/expenses` exigent un
en-tête `Authorization: Bearer <jeton>`.

### Authentification

| Méthode | Route | Accès | Description |
|---|---|---|---|
| `POST` | `/api/auth/login` | public | `{ email, password }` → `{ token, user }` |
| `POST` | `/api/auth/register` | public | Création d'un compte `manager` ou `admin` (amorçage) |
| `POST` | `/api/auth/refresh` | connecté | Réémet un jeton pour un compte toujours actif |

`POST /api/auth/login` répond `403` si le compte existe mais n'a pas encore de
mot de passe, `401` si les identifiants sont faux ou le compte désactivé.

Les routes de comptes (`/api/users`, dont la création) sont décrites dans
[xFINT2](./README-xFINT2.md#utilisateurs).

### Notes de frais

| Méthode | Route | Accès | Description |
|---|---|---|---|
| `GET` | `/api/expenses/mine` | connecté | Ses propres notes |
| `GET` | `/api/expenses/all` | manager, comptabilité, admin | Toutes les notes, avec l'identité du salarié |
| `POST` | `/api/expenses` | connecté | Création, statut `submitted` d'emblée |
| `GET` | `/api/expenses/:id` | propriétaire ou rôle valideur | Détail + pièces jointes |
| `PATCH` | `/api/expenses/:id/status` | manager, comptabilité, admin | Décision |
| `POST` | `/api/expenses/:id/attachments` | propriétaire, admin | Envoi multipart, champ `files` |
| `GET` | `/api/expenses/:id/attachments/:attachmentId` | propriétaire ou rôle valideur | Téléchargement |

**`POST /api/expenses`**

```json
{
  "title": "Taxi gare → client",
  "comment": "Rendez-vous commercial",
  "category": "travel",
  "amount": 42.5,
  "expense_date": "2026-09-01"
}
```

`title` et `category` sont obligatoires. `amount` et `expense_date` ont un repli
(0 et la date du jour). `comment` alimente la colonne `description`.

**`PATCH /api/expenses/:id/status`**

```json
{ "status": "approved", "comment": "OK pour moi" }
```

`status` vaut `approved`, `rejected` ou `reimbursed`. Le statut réel est déduit
du rôle et de l'étape en cours : un `approved` posé par un manager donne
`approved_manager`, le même posé par la comptabilité donne
`approved_accounting`. Une transition impossible renvoie `409`.

### Codes de retour

| Code | Signification |
|---|---|
| `400` | Payload invalide, identifiant mal formé, type de fichier refusé |
| `401` | Jeton absent, invalide ou expiré |
| `403` | Rôle insuffisant, ou tentative de valider sa propre note |
| `404` | Ressource inexistante |
| `409` | Transition de statut impossible |

Le corps d'erreur est toujours `{ "error": "..." }`, éventuellement complété
d'un champ `details` pour les erreurs de validation.

---

## 7. Architecture

### Organisation

```
backend/
  src/
    index.ts              amorçage Express, schéma et migrations au démarrage
    db.ts                 pool PostgreSQL
    database/
      schema.sql          schéma complet, joué sur une base vierge
      migrations/         migrations idempotentes, rejouées à chaque démarrage
    middleware/auth.ts    vérification du jeton, garde-fous par rôle
    routes/
      auth.ts             connexion, inscription, renouvellement
      expenses.ts         xFINT1
      leaves.ts           xFINT2
      users.ts            annuaire et comptes
    lib/                  jours ouvrés, configuration des uploads
  scripts/seed.ts         comptes de démonstration
  uploads/                justificatifs (hors dépôt)

frontend/
  src/
    api.ts                client HTTP, jeton, téléchargements
    types/index.ts        miroir des types backend
    expenseLabels.ts      libellés, couleurs et formatage xFINT1
    components/           Layout, ProtectedRoute, modales de détail
    pages/xfint1/         écrans notes de frais
    pages/xfint2/         écrans congés
```

### Schéma de données

```
users ──┬─< expense_notes ──< attachments
        │        (user_id)      (expense_note_id)
        ├──< leave_requests ──< leave_attachments      → voir xFINT2
        └──< leave_balances
```

**`expense_notes`** porte deux jeux de colonnes de décision, un par étape :
`manager_id` / `manager_comment` / `manager_action_at` d'un côté,
`accountant_id` / `accountant_comment` / `accountant_action_at` de l'autre. La
route d'écriture choisit le jeu selon le rôle qui agit, ce qui garde la trace
des deux décisions.

`amount` est un `NUMERIC(10,2)` : PostgreSQL le sérialise en chaîne, et les
types TypeScript reflètent ce contrat des deux côtés.

**`attachments`** ne stocke que le nom de fichier généré côté serveur dans
`file_path`. Ce champ n'est jamais renvoyé par l'API, et le chemin est
renormalisé avant lecture pour écarter toute traversée de répertoire.

### Authentification

1. `POST /api/auth/login` vérifie le mot de passe avec bcrypt (coût 12) et
   renvoie un JWT contenant `{ id, email, role }`, signé avec le secret partagé
   (HS256, l'algorithme par défaut de `jsonwebtoken`).
2. Le front stocke le jeton et l'utilisateur dans `localStorage`, et joint
   l'en-tête `Authorization` à chaque appel.
3. Le middleware `authenticate` vérifie la signature et renseigne `req.user`.
   `requireRole(...)` filtre ensuite par rôle.
4. `ProtectedRoute` fait le pendant côté interface : redirection vers `/login`
   sans session, vers l'accueil si le rôle ne convient pas.

Le contrôle côté interface n'est qu'un confort d'affichage — chaque route de
l'API applique ses propres vérifications.

### Rôles

| Rôle | Périmètre xFINT1 |
|---|---|
| `employee` | Ses propres notes |
| `manager` | Ses notes, validation de toutes les notes, création de comptes |
| `accounting` | Ses notes, validation comptable et remboursement |
| `hr` | Ses notes uniquement (voir xFINT2 pour ses attributions) |
| `admin` | Accès complet, avance d'une étape à la fois dans le circuit |
