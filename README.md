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

## Gestion des Cores (Git Worktrees)

Les versions de Dolibarr dans `cores/` ne sont pas des copies, mais des "worktrees" qui partagent la même base Git pour économiser de l'espace.

Pour ajouter une nouvelle version (ex: 15) :
```bash
git -C dolibarr-source worktree add ../cores/dolibarr-15 15.0
```

## Utilisation de `./client`

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
