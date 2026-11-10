FROM ghcr.io/astral-sh/uv:0.11.19@sha256:b46b03ddfcfbf8f547af7e9eaefdf8a39c8cebcba7c98858d3162bd28cf536f6 AS uv
FROM oraclelinux@sha256:377bdd87c32d4866618b771e4e3960eb3b3914e2a136defc78b997f1b0b8df7a

ARG NODE_VERSION
ARG PNPM_VERSION
RUN dnf install -y curl tar gzip xz git libstdc++ libgomp util-linux findutils && dnf clean all
COPY --from=uv /uv /uvx /usr/local/bin/
SHELL ["/bin/bash", "-euo", "pipefail", "-c"]
RUN source /etc/os-release && test "$ID" = ol && test "${VERSION_ID%%.*}" = 9 && test "$(uname -m)" = aarch64
RUN cd /tmp && \
    curl --fail --location --output node.tar.xz "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-arm64.tar.xz" && \
    curl --fail --location --output SHASUMS256.txt "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" && \
    expected="$(grep " node-v${NODE_VERSION}-linux-arm64.tar.xz$" SHASUMS256.txt | cut -d ' ' -f 1)" && \
    test -n "$expected" && printf '%s  node.tar.xz\n' "$expected" | sha256sum -c - && \
    tar -xJf node.tar.xz --strip-components=1 -C /usr/local && \
    rm node.tar.xz SHASUMS256.txt
RUN npm install --global "pnpm@${PNPM_VERSION}"
ENV HUSKY=0
RUN uv python install 3.12
CMD ["bash"]
