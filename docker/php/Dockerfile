ARG PHP_VERSION
FROM ${PHP_VERSION}

# Install docker-php-extension-installer
ADD https://github.com/mlocati/docker-php-extension-installer/releases/latest/download/install-php-extensions /usr/local/bin/

RUN chmod +x /usr/local/bin/install-php-extensions && \
    install-php-extensions \
    gd \
    calendar \
    intl \
    imap \
    zip \
    mysqli \
    opcache

# Set permissions for Dolibarr (assuming www-data:www-data)
RUN if [ -f /etc/alpine-release ]; then apk add --no-cache shadow; fi && \
    usermod -u 1001 www-data && groupmod -g 1001 www-data

# PHP sessions must live in a writable directory owned by the FPM user.
# Ownership is also fixed at container start because a named volume can hide the image dir.
RUN mkdir -p /sessions && \
    chown www-data:www-data /sessions && \
    chmod 700 /sessions && \
    printf "session.save_path=/sessions\n" > /usr/local/etc/php/conf.d/zz-session-path.ini

COPY entrypoint.sh /usr/local/bin/dolibarr-php-entrypoint.sh
RUN chmod +x /usr/local/bin/dolibarr-php-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/dolibarr-php-entrypoint.sh"]
CMD ["php-fpm"]

WORKDIR /var/www/html
