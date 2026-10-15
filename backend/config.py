"""Configuration read from environment variables or an ignored local .env file."""

import os


def load_env_file(filepath: str = ".env"):
    """Read local defaults without overriding injected environment variables."""
    env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), filepath)
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as env_file:
            for line in env_file:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, value = line.split("=", 1)
                    os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_env_file()


class CloudConfig:
    GCP_PROJECT_ID: str = os.getenv("GCP_PROJECT_ID", "")
    GOOGLE_MAPS_API_KEY: str = os.getenv("GOOGLE_MAPS_API_KEY", "")
    PLANET_API_KEY: str = os.getenv("PLANET_API_KEY", "")
    GCS_BUCKET_NAME: str = os.getenv("GCS_BUCKET_NAME", "")
    GOOGLE_APPLICATION_CREDENTIALS: str = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "")
    COPERNICUS_USERNAME: str = os.getenv("COPERNICUS_USERNAME", "")
    COPERNICUS_PASSWORD: str = os.getenv("COPERNICUS_PASSWORD", "")
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    ENVIRONMENT: str = os.getenv("ENVIRONMENT", "local")


cloud_config = CloudConfig()
