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
git clone https://github.com/10lsv/sup-herman sup-herman-projects
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
serveur applique `backend/src/database/schema.sql` si la base est vierge, puis
rejoue les migrations de `backend/src/database/migrations/`. Elles sont écrites
idempotentes et se rejouent sans dommage sur une base déjà en service.

Les six types de congé sont insérés par le schéma : congés payés (25 j), RTT
(10 j), arrêt maladie, événement familial, congé sans solde et formation. Les
quatre derniers sont sans dotation : ils sont décomptés, jamais bloquants.

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
| `rh@supherman.com` | `Suph3rm4n!` | RH |
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

L'interface affiche les libellés du sujet :

| Libellé affiché | Badge | Statut interne |
|---|---|---|
| En attente | orange | `submitted` — la demande attend le manager |
| Validée | bleu | `approved_manager` — validée par le manager, en attente de confirmation RH |
| Validée | vert | `approved_hr` — confirmée par la RH, les jours sont décomptés |
| Refusée | rouge | `rejected` |
| Annulée | gris | `cancelled` |

La modale de détail d'une demande validée précise l'étape atteinte : « Validée
par le manager le … — en attente de confirmation RH », puis « Confirmée par la
RH le … ». Sur l'écran de validation, le filtre « Statut » sépare les deux
étapes (« Validée (manager) », « Validée (RH) ») ; la case « À traiter par moi »
isole les demandes qui attendent précisément votre décision.

Le demandeur peut annuler sa demande à tout moment tant qu'elle n'est pas close,
y compris après validation RH : les jours lui sont alors restitués. Personne ne
valide sa propre demande.

La RH peut en outre **corriger le statut de n'importe quelle demande**, close
comprise (voir « RH » ci-dessous) : les compteurs du solde sont recalculés à
chaque correction.

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

### Accueil

La page d'accueil commune (`/dashboard`, décrite dans
[xFINT1](./README-xFINT1.md#accueil)) résume les congés : soldes de congés payés
et de RTT restants, nombre de demandes en attente de validation, prochain congé
validé. Pour le manager et la RH, la carte **À traiter** compte les demandes
qui attendent leur décision.

Dans le menu, la section **Congés** regroupe Tableau de bord, Mes demandes,
Nouvelle demande, Calendrier, À valider (manager, RH) et Gestion RH (RH).

### Salarié

- **Tableau de bord** (`/leaves`) — les soldes par type sous forme de jauges,
  les demandes en cours de validation, les congés validés à venir.
- **Mes demandes** (`/leaves/list`) — l'historique complet : type, dates, jours,
  statut. Un clic ouvre le détail.
- **Nouvelle demande** (`/leaves/new`) — type, date de début, date de fin,
  motif, justificatif.
  - Le nombre de jours décomptés, le solde du type choisi et le solde après
    demande s'affichent en direct pendant la saisie, avec le détail jour par
    jour.
  - Trois contrôles bloquants signalés avant l'envoi : date de fin antérieure au
    début, période sans jour ouvré, chevauchement avec une demande existante.
    Le serveur les revérifie tous.
  - Justificatif attendu pour maladie, formation et événement familial. Formats
    acceptés : JPEG, PNG, WebP, HEIC, PDF, 10 Mo par fichier, 10 fichiers.
- **Calendrier** (`/leaves/calendar`) — vue mensuelle, ouverte à tous les
  rôles, une couleur par type de congé. Y figurent les congés validés : ceux
  confirmés par la RH, et ceux validés par le manager en attente de la RH
  (affichés estompés). Le sélecteur « Affichage » propose « Mes congés »,
  « Toute l'entreprise » et une entrée par équipe (un manager et les salariés
  qui lui sont rattachés) ; un manager arrive sur son équipe. Le détail d'un
  congé ne s'ouvre que sur ses propres demandes, ou pour un manager, la RH et
  un admin.
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

**Corriger une erreur** — dans le détail de n'importe quelle demande (sauf la
sienne), la RH dispose de boutons supplémentaires :

| Statut actuel | Actions RH |
|---|---|
| Refusée ou annulée | **Valider**, **Remettre en attente** |
| Validée (RH) | **Refuser**, **Remettre en attente**, Annuler |

Un refus prononcé par la RH exige un commentaire RH. Chaque correction
recalcule le solde : les jours comptés en attente ou pris sont restitués, puis
réengagés selon le nouveau statut (en attente → « en attente », validée →
« pris », refusée ou annulée → rien). Une remise en attente ou une validation
est refusée si la période chevauche une autre demande active du salarié ; une
validation l'est aussi si le solde ne suffit pas.

- **Gestion RH** (`/leaves/hr`) — l'annuaire complet : email,
  rôle, manager de rattachement, état du compte, soldes CP et RTT.
  - **+ Créer un utilisateur** — email, rôle (Employé, Manager ou RH) et
    manager responsable, choisi parmi les managers actifs (facultatif). Le
    compte est créé sans mot de passe : la modale affiche le **lien
    d'activation**, avec un bouton pour le copier, et la liste se met à jour.
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

Un compte créé depuis **Utilisateurs** (`/admin/users`, manager ou RH) ou depuis
**Gestion RH** (`/leaves/hr`) n'a
pas de mot de passe et ne peut donc pas se connecter. Son créateur reçoit un
lien d'activation, affiché **une seule fois** à la création et valable 7 jours,
que le salarié ouvre pour choisir son mot de passe (`/set-password`).

Si le lien est perdu ou expiré, la RH définit un mot de passe provisoire depuis
l'écran RH. Tout utilisateur connecté peut ensuite changer le sien depuis
**Mon profil** → **Changer mon mot de passe**, en fournissant l'actuel.

---

## 6. Documentation de l'API

Base : `http://localhost:3000`. Toutes les routes `/api/leaves` et, sauf
exception signalée, `/api/users` exigent un en-tête
`Authorization: Bearer <jeton>`.

### Congés

| Méthode | Route | Accès | Description |
|---|---|---|---|
| `GET` | `/api/leaves/mine` | connecté | Ses propres demandes |
| `GET` | `/api/leaves/all` | manager, RH, admin | Toutes les demandes |
| `GET` | `/api/leaves/calendar` | connecté | Congés validés d'une période, pour le calendrier |
| `POST` | `/api/leaves` | connecté | Création, statut `submitted` d'emblée |
| `GET` | `/api/leaves/:id` | propriétaire ou rôle valideur | Détail + justificatifs |
| `PATCH` | `/api/leaves/:id/status` | valideurs ; annulation aussi au demandeur ; correction par la RH | Décision |
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

**`GET /api/leaves/calendar?from=2026-09-01&to=2026-09-30&team=1`**

`from` et `to` sont obligatoires (`YYYY-MM-DD`, `from` ≤ `to`) ; la réponse
contient les congés qui chevauchent la période. `team` est facultatif : l'id
d'un manager, qui restreint aux salariés rattachés à ce manager et au manager
lui-même. Seuls les statuts `approved_manager`, `approved_hr` et `approved`
sont renvoyés, avec une projection réduite — jamais de motif, de commentaire,
de justificatif ni d'email :

```json
[
  {
    "id": 1,
    "user_id": 2,
    "user_first_name": "Émile",
    "user_last_name": "Employé",
    "manager_id": 1,
    "leave_type": { "code": "PAID", "label": "Congés payés" },
    "date_start": "2026-09-14",
    "date_end": "2026-09-18",
    "days_requested": "5.00",
    "status": "approved_hr"
  }
]
```

`manager_id` est le manager de rattachement du salarié, pas le valideur de la
demande.

**`PATCH /api/leaves/:id/status`**

```json
{ "status": "approved", "comment": "Bonnes vacances" }
```

`status` vaut `approved`, `rejected` ou `cancelled`. Comme pour les notes de
frais, le statut réel dépend du rôle et de l'étape : un `approved` posé par un
manager donne `approved_manager`, le même posé par la RH donne `approved_hr`.
Pour un manager ou un salarié, une demande refusée ou annulée est close :
toute nouvelle décision renvoie `409`.

**Correction par la RH ou un admin.** Deux valeurs supplémentaires,
`submitted` et `approved_hr`, fixent directement le statut cible ; avec
`rejected` et `cancelled`, elles sont acceptées **depuis n'importe quel
statut**, demande close comprise.

```json
{ "status": "approved_hr", "comment": "Refus erroné, congé accordé" }
```

| Règle | Réponse en cas d'échec |
|---|---|
| `submitted` ou `approved_hr` envoyé par un autre rôle | `403` |
| `rejected` sans `comment` (RH, admin) | `400` |
| Statut cible identique au statut actuel | `409` |
| `submitted` / `approved_hr` : période qui chevauche une autre demande active | `409` |
| `approved_hr` : solde insuffisant sur un type plafonné | `409` |

Le solde est recalculé dans la même transaction : ce qui était compté (en
attente ou pris) est restitué, puis réengagé selon le nouveau statut.

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
| `GET` | `/api/users/managers` | connecté | Managers actifs (id, prénom, nom), pour le filtre par équipe |
| `POST` | `/api/users` | manager, RH, admin | Crée un compte, renvoie le jeton d'activation |
| `PATCH` | `/api/users/:id` | RH, admin | Identité, email, rôle, rattachement, activation |
| `PATCH` | `/api/users/:id/password` | trois modes, voir ci-dessous | Définit un mot de passe |

**`POST /api/users`**

```json
{ "email": "prenom.nom@exemple.fr", "role": "employee", "manager_id": 1 }
```

Les rôles attribuables dépendent du créateur :

| Créateur | Rôles autorisés |
|---|---|
| `manager` | `employee`, `manager`, `accounting` |
| `hr` | `employee`, `manager`, `hr` |
| `admin` | tous |

Un rôle hors de cette liste est refusé en `403`, avec un message qui rappelle
les rôles autorisés. `manager_id` est facultatif : s'il est fourni, il doit
désigner un compte actif de rôle `manager` ou `admin`, sinon `400`. Sans
`manager_id`, un compte `manager` créé par un manager ou un admin est rattaché à
son créateur ; tous les autres restent sans manager.

La réponse reprend le compte créé, plus `invite_token` et `invite_expires_at`.
Le lien d'activation est
`<front>/set-password?user=<id>&token=<invite_token>`. Le jeton n'est renvoyé
qu'ici : la base n'en garde que l'empreinte.

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
| `hr` | Idem, plus la seconde étape, l'annuaire, la création de comptes, les soldes et les mots de passe |
| `accounting` | Ses demandes uniquement (voir xFINT1 pour ses attributions) |
| `admin` | Accès complet, avance d'une étape à la fois dans le circuit |
