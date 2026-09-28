#!/bin/sh
set -eu
printf '%s  %s\n' '65b78baadd3f0984055de89bf13f4a1932e5bfe9c31932037a134ea2b1a0ce42' /build/openresty-1.31.1.1.tar.gz | sha256sum -c -
cd /tmp
tar -xzf /build/openresty-1.31.1.1.tar.gz
cd /tmp/openresty-1.31.1.1/bundle/nginx-1.31.1
for security_patch in /build/patches/*.patch; do
    patch --batch --fuzz=0 -p1 < "$security_patch"
done
export LUAJIT_LIB=/usr/local/openresty/luajit/lib
export LUAJIT_INC=/usr/local/openresty/luajit/include/luajit-2.1
./configure --prefix=/usr/local/openresty/nginx '--with-cc-opt=-O2 -DNGX_LUA_ABORT_AT_PANIC -I/usr/local/openresty/pcre2/include -I/usr/local/openresty/openssl3/include' --add-module=../ngx_devel_kit-0.3.4 --add-module=../echo-nginx-module-0.64 --add-module=../xss-nginx-module-0.07 --add-module=../ngx_coolkit-0.2 --add-module=../set-misc-nginx-module-0.33 --add-module=../form-input-nginx-module-0.12 --add-module=../encrypted-session-nginx-module-0.09 --add-module=../srcache-nginx-module-0.33 --add-module=../ngx_lua-0.10.31rc5 --add-module=../ngx_lua_upstream-0.08 --add-module=../headers-more-nginx-module-0.39 --add-module=../array-var-nginx-module-0.06 --add-module=../memc-nginx-module-0.20 --add-module=../redis2-nginx-module-0.15 --add-module=../redis-nginx-module-0.41 --add-module=../ngx_stream_lua-0.0.19rc4 '--with-ld-opt=-Wl,-rpath,/usr/local/openresty/luajit/lib -L/usr/local/openresty/pcre2/lib -L/usr/local/openresty/openssl3/lib -Wl,-rpath,/usr/local/openresty/pcre2/lib:/usr/local/openresty/openssl3/lib' --with-pcre --with-compat --without-mail_pop3_module --without-mail_imap_module --without-mail_smtp_module --with-http_addition_module --with-http_auth_request_module --with-http_dav_module --with-http_flv_module --with-http_geoip_module=dynamic --with-http_gunzip_module --with-http_gzip_static_module --with-http_image_filter_module=dynamic --with-http_mp4_module --with-http_random_index_module --with-http_realip_module --with-http_secure_link_module --with-http_slice_module --with-http_ssl_module --with-http_stub_status_module --with-http_sub_module --with-http_v2_module --with-http_v3_module --with-http_xslt_module=dynamic --with-ipv6 --with-mail --with-mail_ssl_module --with-md5-asm --with-sha1-asm --with-stream --with-stream_ssl_module --with-stream_ssl_preread_module --with-threads --with-pcre-jit --with-stream --build=smtvv-security-20260916
make -j1
mkdir -p /output
cp objs/nginx /output/nginx
cp objs/*.so /output/
sha256sum /output/nginx > /output/binary.sha256
