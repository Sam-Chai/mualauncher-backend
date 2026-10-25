# Supply reviewed native/multiarch manifest digests. Build/pull is an administrator action, never a job action.
ARG NODE_IMAGE
ARG JAVA_IMAGE
FROM ${NODE_IMAGE} AS node
FROM ${JAVA_IMAGE}
USER 0:0
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY keeper.mjs seal.mjs /opt/unionlink/
RUN test -x /opt/java/openjdk/bin/java && test -x /usr/bin/timeout && test -x /bin/tar && test -x /bin/cp && test -x /bin/dmesg \
    && /usr/local/bin/node --version && mkdir -p /input /workspace
LABEL org.unionlink.execution.protocol="1"
ENV HOME=/tmp LANG=C.UTF-8 JAVA_TOOL_OPTIONS="" JDK_JAVA_OPTIONS="" _JAVA_OPTIONS="" CLASSPATH=""
ENTRYPOINT ["/usr/local/bin/node", "/opt/unionlink/keeper.mjs"]
CMD ["1800"]
