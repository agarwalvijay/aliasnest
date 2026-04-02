module.exports = {
  apps: [
    {
      name: "aliasnest-api",
      cwd: "/home/vagarwal/aliasnest",
      script: "/home/vagarwal/aliasnest/deploy/run-api.sh",
      interpreter: "none",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      env: {
        PYTHONUNBUFFERED: "1"
      }
    }
  ]
};
