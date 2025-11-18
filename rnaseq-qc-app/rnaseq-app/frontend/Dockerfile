FROM nginx:alpine

RUN rm -rf /usr/share/nginx/html/*

COPY . /usr/share/nginx/html

# Disable nginx caching for dev
RUN echo "server { \
    listen 80; \
    root /usr/share/nginx/html; \
    location / { \
        add_header Cache-Control \"no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0\"; \
    } \
}" > /etc/nginx/conf.d/default.conf
