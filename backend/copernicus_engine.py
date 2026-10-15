"""
Copernicus Data Space Ecosystem (CDSE) Integration Engine.
Handles OAuth2 token acquisition, Sentinel-2 metadata, and deep-link generation
for forest plot verification and EUDR compliance auditing.
"""

import urllib.request
import urllib.parse
import json
import time
from typing import Dict, Any, Optional
from config import cloud_config

class CopernicusEngine:
    def __init__(self):
        self.username = cloud_config.COPERNICUS_USERNAME
        self.password = cloud_config.COPERNICUS_PASSWORD
        self.token_url = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token"
        self._cached_token = None
        self._token_expires_at = 0

    def get_access_token(self) -> Optional[str]:
        """Obtains or refreshes JWT bearer token from Copernicus Keycloak."""
        if not self.username or not self.password:
            return None
        now = time.time()
        if self._cached_token and now < self._token_expires_at - 60:
            return self._cached_token

        payload = {
            "client_id": "cdse-public",
            "username": self.username,
            "password": self.password,
            "grant_type": "password"
        }

        data_encoded = urllib.parse.urlencode(payload).encode("utf-8")
        req = urllib.request.Request(
            self.token_url,
            data=data_encoded,
            headers={"Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Mozilla/5.0"}
        )

        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                self._cached_token = data.get("access_token")
                expires_in = data.get("expires_in", 1800)
                self._token_expires_at = now + expires_in
                return self._cached_token
        except Exception as e:
            print("Copernicus token error:", e)
            return None

    def generate_copernicus_browser_url(self, lat: float, lon: float, mode: str = "eudr_2020", zoom: int = 14) -> str:
        """
        Generates an exact deep-link into Copernicus Browser
        focused on a specific forest plot with pre-selected layer and date.
        """
        base_url = "https://browser.dataspace.copernicus.eu/"

        if mode == "eudr_2020":
            # December 2020 (EUDR cutoff date)
            date_from = "2020-12-01T00:00:00.000Z"
            date_to = "2020-12-31T23:59:59.999Z"
            layer_id = "1_TRUE_COLOR"
        elif mode == "ndvi":
            # NDVI Vegetation Index (Greenness & Canopy Health)
            date_from = "2024-01-01T00:00:00.000Z"
            date_to = "2026-08-31T23:59:59.999Z"
            layer_id = "3_NDVI"
        elif mode == "false_color":
            # False color infrared (B08, B04, B03 - highlights tree growth vs soil)
            date_from = "2024-01-01T00:00:00.000Z"
            date_to = "2026-08-31T23:59:59.999Z"
            layer_id = "2_FALSE_COLOR"
        else: # Recent True Color
            date_from = "2024-01-01T00:00:00.000Z"
            date_to = "2026-08-31T23:59:59.999Z"
            layer_id = "1_TRUE_COLOR"

        params = {
            "zoom": str(zoom),
            "lat": f"{lat:.5f}",
            "lng": f"{lon:.5f}",
            "themeId": "DEFAULT-THEME",
            "datasetId": "S2_L2A_CDAS",
            "fromTime": date_from,
            "toTime": date_to,
            "layerId": layer_id
        }

        query_str = urllib.parse.urlencode(params)
        return f"{base_url}?{query_str}"

copernicus_engine = CopernicusEngine()
