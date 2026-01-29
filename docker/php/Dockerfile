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

WORKDIR /var/www/html
