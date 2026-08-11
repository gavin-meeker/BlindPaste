# Built with the repo root as context (see src/BlindPaste.Api/railway.json's
# dockerfilePath, and docker-compose.yml if that ever grows an api service). Not
# `src/BlindPaste.Api/` alone: Directory.Build.props sits one level up, at
# src/Directory.Build.props, and MSBuild finds it by walking up from the project
# file — a context scoped to this directory would leave it unreachable.
#
# Private-only by design: this image binds a fixed port rather than Railway's
# dynamic $PORT, because nothing public ever talks to it directly. The UI service's
# Caddy reverse-proxies /api/* to it over Railway's private network, so the only
# thing that needs to know this port is that Caddyfile. See web/railway.json.

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /repo

# Restore first, with only the files restore depends on, so editing application
# code doesn't invalidate this layer on every build.
COPY global.json global.json
COPY src/Directory.Build.props src/Directory.Build.props
COPY src/BlindPaste.Api/BlindPaste.Api.csproj src/BlindPaste.Api/BlindPaste.Api.csproj
RUN dotnet restore src/BlindPaste.Api/BlindPaste.Api.csproj

COPY src/BlindPaste.Api/ src/BlindPaste.Api/

# No --no-restore: publish's own restore is a fast no-op reusing the layer above when
# the .csproj is unchanged, and skipping it has been unreliable across SDK versions —
# NETSDK1064 fired here despite the identical package having just been restored.
RUN dotnet publish src/BlindPaste.Api/BlindPaste.Api.csproj \
    --configuration Release \
    --output /app

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app

# The slim base image ships without libgssapi-krb5-2. Npgsql probes for it on every
# new physical connection regardless of whether GSSAPI auth is in use, and without it
# logs a raw "cannot open shared object file" error to stderr on each one — confirmed
# by actually running this image against Postgres, not assumed from the Dockerfile.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgssapi-krb5-2 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app ./

# Fixed and internal — see the note above. Kestrel binds 0.0.0.0, not the aspnet
# image's localhost default, which nothing outside this container could reach.
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080

ENTRYPOINT ["dotnet", "BlindPaste.Api.dll"]
