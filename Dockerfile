# AgentToll Rust binaries: gateway, buyer CLI, demo origin, SIMULATED facilitator.
FROM rust:1-bookworm AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates crates
COPY demo/origin demo/origin
COPY demo/mock-facilitator demo/mock-facilitator
RUN cargo build --release --locked \
      -p agenttoll-gateway -p agenttoll-buyer -p agenttoll-demo-origin -p agenttoll-mock-facilitator

FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 --home /data agenttoll \
 && mkdir -p /data && chown agenttoll /data
COPY --from=build /src/target/release/agenttoll-gateway \
                  /src/target/release/agenttoll-buyer \
                  /src/target/release/agenttoll-demo-origin \
                  /src/target/release/agenttoll-mock-facilitator /usr/local/bin/
USER agenttoll
WORKDIR /data
CMD ["agenttoll-gateway", "--config", "/etc/agenttoll/agenttoll.yaml"]
