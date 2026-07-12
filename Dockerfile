FROM node:25-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4173

COPY package.json server.js ./
COPY public ./public
COPY src ./src
COPY data ./data

EXPOSE 4173

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:4173/api/health').then((r)=>{if(!r.ok)process.exit(1);return r.json();}).then((j)=>process.exit(j.ok?0:1)).catch(()=>process.exit(1));"

CMD ["node", "server.js"]
