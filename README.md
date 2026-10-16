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

Note: `./client create` ne pré-crée plus `conf/conf.php` pour laisser Dolibarr démarrer en mode "Fresh install" propre.
Les champs de la page d'installation restent pré-remplis via `clients/<client>/conf/install.forced.php` (généré automatiquement).

### Commandes usuelles
- `./client up <client>` : Démarre l'instance.
- `./client down <client> [--volumes]` : Arrête l'instance.
- `./client restore <client> [dump.sql(.gz)]` : Restaure une BDD et crée le `install.lock`.
- `./client logs <client>` : Logs en temps réel.
- `./client build <client>` : Reconstruit l'image PHP.
- `./client cores-update` : Met à jour les worktrees Dolibarr installés.
- `./client core-add <version>` : Ajoute un core stable depuis la branche officielle `<version>.0`.
- `./client source-update` : Met à jour le checkout local de `dolibarr-source`.

### Console web d'administration (accès local)

La console affiche les instances et leurs états, ouvre les URL, lit les 200 dernières lignes de logs et expose les actions d'instance (création, démarrage, arrêt, redémarrage, reconstruction, nettoyage et restauration d'une sauvegarde). Depuis la restauration, un dump `.sql` ou `.sql.gz` de 2 Go maximum peut être importé dans le dossier de sauvegarde de l'instance. La console permet aussi de mettre à jour `dolibarr-source`, de mettre à jour les cores installés et d'ajouter une version stable disponible sur la branche officielle. Les actions de base de données demandent de retaper le nom de l'instance.

Depuis ce dépôt sur la machine locale, lancez `./client-web`. Le script ajoute `127.0.0.1 admin.local` à `/etc/hosts` si nécessaire (avec demande de mot de passe `sudo`), démarre Traefik et la console, puis affiche `http://admin.local`. La création d'une instance ajoute aussi son domaine local à `/etc/hosts`. La console ne demande aucun identifiant.

La console est servie par Traefik sur le port HTTP 80, lié à `127.0.0.1`. Elle rejoint le réseau privé partagé avec Traefik et un réseau sortant dédié, non partagé avec les instances, utilisé pour les mises à jour Git. Le conteneur utilise le socket Docker, le dépôt monté en lecture-écriture et `/etc/hosts` pour piloter les instances et ajouter leurs domaines locaux ; les commandes du client sont lancées avec l'UID/GID courant pour préserver les propriétaires des fichiers. Docker et le plugin Docker Compose doivent être installés, et l'utilisateur courant doit pouvoir accéder au daemon Docker. `./client-web stop` arrête la console ; `./client-web logs` affiche ses logs. Le proxy reste actif pour les autres instances. La console n'expose pas de terminal, de configuration avec secrets ni la mise à jour globale du dépôt.

## Architecture

Les dossiers `custom` des clients sont montés dans `/var/www/html/custom/` pour assurer la visibilité des modules.
Le fichier `conf.php` utilise des chemins absolus pour éviter les erreurs de logs.


rsync -avz -e "ssh -p 6022" \
  --exclude='facture' \
  --exclude='commande' \
  --exclude='expedition' \
  --exclude='fournisseur' \
  dolihumb@95.178.89.203:/usr/share/dolibarr/htdocs/documents .  
