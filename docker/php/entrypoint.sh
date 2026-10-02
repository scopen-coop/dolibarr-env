#!/bin/sh
set -eu

mkdir -p /sessions
chown www-data:www-data /sessions
chmod 700 /sessions

exec docker-php-entrypoint "$@"
