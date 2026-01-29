# Dolibarr Multi-Client Environment

Ce projet permet de gérer plusieurs instances de Dolibarr de manière isolée tout en partageant une infrastructure commune (Reverse Proxy, Base de données MariaDB partagée) via Docker.

## Structure du Projet

- `reverse-proxy/` : Configuration Traefik (v3) pour le routage des noms de domaines.
- `database/` : Configuration de la base de données MariaDB partagée (`dolibarr-db`).
- `docker/` : Configuration Docker pour les services Nginx et PHP par client.
- `clients/` : Données spécifiques à chaque client (fichiers `.env`, conf, documents, modules custom).
- `dolibarr-source/` : **Submodule Git** pointant vers le dépôt officiel Dolibarr.
- `cores/` : Dossiers de versions basés sur des **Git Worktrees** liés au submodule.
- `modules-common/` : Modules Dolibarr partagés entre tous les clients.
- `./client` : Script de gestion principal.

## Installation Initiale (Git)

Après avoir cloné ce dépôt, vous devez initialiser le submodule et les worktrees pour les versions de Dolibarr.

### 1. Initialiser le Submodule
```bash
git submodule update --init --recursive
```

### 2. Configurer les Worktrees (Cores)
Les dossiers dans `cores/` sont ignorés par Git. Vous devez les recréer à partir du submodule :
```bash
# Exemple pour les versions courantes
mkdir -p cores
for v in 16 17 18 19 20 21 22; do
  git -C dolibarr-source worktree add ../cores/dolibarr-${v} ${v}.0
done
```

### 3. Mettre à jour Dolibarr
Pour récupérer les dernières mises à jour du dépôt officiel :
```bash
git submodule update --remote --merge
```
Cela mettra à jour votre dossier `dolibarr-source`. Les dossiers dans `cores/` étant branchés sur des noms de branches (ex: `18.0`), ils seront également à jour lors de vos prochaines opérations Docker.

## Gestion des Clients via `./client`

### Créer un nouveau client
```bash
./client create <nom> [version_dolibarr] [image_php]
```
Exemple : `./client create mon-projet 18 php:7.4-fpm-alpine`

### Commandes usuelles
- `./client up <client>` : Démarre l'instance.
- `./client down <client> [--volumes]` : Arrête l'instance.
- `./client restore <client> [dump.sql.gz]` : Restaure une BDD et crée le `install.lock`.
- `./client logs <client>` : Logs en temps réel.
- `./client build <client>` : Reconstruit l'image PHP.

## Architecture

Les dossiers `custom` des clients sont montés dans `/var/www/html/custom/` pour assurer la visibilité des modules.
Le fichier `conf.php` utilise des chemins absolus pour éviter les erreurs de logs.
