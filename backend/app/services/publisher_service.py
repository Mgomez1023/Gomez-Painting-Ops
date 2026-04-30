from collections.abc import Callable
from typing import Any, Protocol

import httpx
from pydantic import BaseModel, Field

from app.config import Settings, settings
from app.models.campaign_content import CampaignContentQueueItem


class PublishingError(RuntimeError):
    """Raised when publishing cannot be completed."""


class ManualPostFallbackRequired(PublishingError):
    """Raised when real API publishing is unavailable and manual posting is required."""

    def __init__(self, message: str, copy_ready_package: str) -> None:
        super().__init__(message)
        self.copy_ready_package = copy_ready_package


class PublisherResult(BaseModel):
    external_post_id: str | None = None
    published_url: str | None = None
    status: str = "Published"
    published: str = "Yes"
    last_publish_error: str | None = None
    notes: str | None = None

    @property
    def succeeded(self) -> bool:
        return self.status == "Published" and self.published == "Yes"


class MetaTargetResult(BaseModel):
    target: str
    status: str
    external_post_id: str | None = None
    published_url: str | None = None
    error: str | None = None
    skipped: bool = False

    @property
    def succeeded(self) -> bool:
        return self.status == "Published"


class PlatformPublisher(Protocol):
    def publish(self, item: CampaignContentQueueItem) -> PublisherResult:
        """Publish a campaign content item through one platform boundary."""


class MockPublisher:
    """Safe local publisher used until real platform APIs are wired in."""

    def publish(self, item: CampaignContentQueueItem) -> PublisherResult:
        platform_slug = item.platform.lower().replace(" ", "-")
        external_post_id = f"mock-{platform_slug}-{item.content_id}"
        return PublisherResult(
            external_post_id=external_post_id,
            published_url=f"https://mock-publisher.local/posts/{external_post_id}",
        )


class MetaGraphErrorClassifier:
    auth_error_codes = {10, 100, 102, 190, 200, 2500, 2601}
    transient_error_codes = {1, 2, 4, 17, 32, 613}

    @classmethod
    def classify(cls, response: httpx.Response, default_action: str) -> tuple[str, str]:
        message = MetaGraphPublisherMixin._format_meta_error(response, default_action)
        code = cls._error_code(response)
        if response.status_code in {401, 403} or code in cls.auth_error_codes:
            return "Publish Blocked", message
        if response.status_code >= 500 or code in cls.transient_error_codes:
            return "Publish Failed", message
        return "Publish Failed", message

    @staticmethod
    def _error_code(response: httpx.Response) -> int | None:
        try:
            payload = response.json()
        except ValueError:
            return None
        if not isinstance(payload, dict):
            return None
        error = payload.get("error")
        if not isinstance(error, dict):
            return None
        code = error.get("code")
        return code if isinstance(code, int) else None


class MetaGraphPublisherMixin:
    def __init__(
        self,
        app_settings: Settings = settings,
        http_client_factory: Callable[[], httpx.Client] | None = None,
    ) -> None:
        self.settings = app_settings
        self._http_client_factory = http_client_factory or (lambda: httpx.Client(timeout=30.0))

    @property
    def graph_api_base(self) -> str:
        return f"https://graph.facebook.com/{self.settings.meta_graph_api_version.strip('/')}"

    def public_image_url(self, item: CampaignContentQueueItem) -> str | None:
        image_url = str(item.image_url or item.image_path or "").strip()
        if image_url.lower().startswith(("http://", "https://")):
            return image_url
        public_base = self.settings.api_public_base_url or self.settings.public_site_base_url
        if image_url.startswith("/") and public_base:
            return f"{public_base.rstrip('/')}{image_url}"
        return None

    @staticmethod
    def _json_response(response: httpx.Response, action: str) -> dict[str, Any]:
        try:
            payload = response.json()
        except ValueError as exc:
            raise PublishingError(f"Meta Graph API {action} response was not valid JSON.") from exc
        if not isinstance(payload, dict):
            raise PublishingError(f"Meta Graph API {action} response was not a JSON object.")
        return payload

    @classmethod
    def _format_meta_error(cls, response: httpx.Response, action: str) -> str:
        message = response.text
        try:
            payload = response.json()
        except ValueError:
            payload = {}
        if isinstance(payload, dict):
            error = payload.get("error")
            if isinstance(error, dict):
                code = error.get("code")
                subcode = error.get("error_subcode")
                pieces = [str(error.get("message") or error)]
                if code is not None:
                    pieces.append(f"code={code}")
                if subcode is not None:
                    pieces.append(f"subcode={subcode}")
                message = "; ".join(pieces)
        return f"Meta Graph API failed to {action} ({response.status_code}): {message}"

    @staticmethod
    def _published_url_for_facebook(page_id: str, post_id: str) -> str:
        return f"https://www.facebook.com/{page_id}/posts/{post_id.split('_')[-1]}"


class FacebookPagePublisher(MetaGraphPublisherMixin):
    """Publisher for owned Facebook Pages through Meta Graph API."""

    target_name = "Facebook"

    def publish(self, item: CampaignContentQueueItem) -> PublisherResult:
        result = self.publish_target(item)
        return meta_target_result_to_publisher_result(result)

    def publish_target(self, item: CampaignContentQueueItem) -> MetaTargetResult:
        if existing_id := extract_meta_target_external_id(item, self.target_name):
            return MetaTargetResult(
                target=self.target_name,
                status="Published",
                external_post_id=existing_id,
                published_url=extract_meta_target_published_url(item, self.target_name),
                skipped=True,
            )

        missing = [
            name
            for name, value in (
                ("FACEBOOK_PAGE_ID", self.settings.facebook_page_id),
                ("FACEBOOK_PAGE_ACCESS_TOKEN", self.settings.facebook_page_access_token),
            )
            if not value
        ]
        if missing:
            return MetaTargetResult(
                target=self.target_name,
                status="Publish Blocked",
                error=f"Missing Meta Facebook Page configuration: {', '.join(missing)}",
            )

        image_url = self.public_image_url(item)
        page_id = self.settings.facebook_page_id or ""
        data: dict[str, str] = {"access_token": self.settings.facebook_page_access_token or ""}
        endpoint = "photos" if image_url else "feed"
        action = "publish Facebook Page photo" if image_url else "publish Facebook Page feed post"
        if image_url:
            data.update({"url": image_url, "caption": item.draft_text})
        else:
            data["message"] = item.draft_text
            if item.landing_page_url:
                data["link"] = item.landing_page_url

        try:
            with self._http_client_factory() as client:
                response = client.post(f"{self.graph_api_base}/{page_id}/{endpoint}", data=data)
        except httpx.HTTPError as exc:
            return MetaTargetResult(target=self.target_name, status="Publish Failed", error=str(exc))

        if response.status_code >= 400:
            status, error = MetaGraphErrorClassifier.classify(response, action)
            return MetaTargetResult(target=self.target_name, status=status, error=error)

        payload = self._json_response(response, action)
        external_id = str(payload.get("post_id") or payload.get("id") or "").strip()
        if not external_id:
            return MetaTargetResult(
                target=self.target_name,
                status="Publish Failed",
                error="Meta Graph API Facebook response did not include a post id.",
            )
        return MetaTargetResult(
            target=self.target_name,
            status="Published",
            external_post_id=external_id,
            published_url=self._published_url_for_facebook(page_id, external_id),
        )


class InstagramPublisher(MetaGraphPublisherMixin):
    """Publisher for owned Instagram Business/Creator accounts through Meta Graph API."""

    target_name = "Instagram"

    def publish(self, item: CampaignContentQueueItem) -> PublisherResult:
        result = self.publish_target(item)
        return meta_target_result_to_publisher_result(result)

    def publish_target(self, item: CampaignContentQueueItem) -> MetaTargetResult:
        if existing_id := extract_meta_target_external_id(item, self.target_name):
            return MetaTargetResult(
                target=self.target_name,
                status="Published",
                external_post_id=existing_id,
                published_url=extract_meta_target_published_url(item, self.target_name),
                skipped=True,
            )

        missing = [
            name
            for name, value in (
                ("INSTAGRAM_BUSINESS_ACCOUNT_ID", self.settings.instagram_business_account_id),
                ("FACEBOOK_PAGE_ACCESS_TOKEN", self.settings.facebook_page_access_token),
            )
            if not value
        ]
        if missing:
            return MetaTargetResult(
                target=self.target_name,
                status="Publish Blocked",
                error=f"Missing Meta Instagram configuration: {', '.join(missing)}",
            )

        image_url = self.public_image_url(item)
        if not image_url:
            return MetaTargetResult(
                target=self.target_name,
                status="Publish Blocked",
                error="Instagram publishing requires a public image URL.",
            )

        ig_user_id = self.settings.instagram_business_account_id or ""
        access_token = self.settings.facebook_page_access_token or ""

        try:
            with self._http_client_factory() as client:
                container_response = client.post(
                    f"{self.graph_api_base}/{ig_user_id}/media",
                    data={"image_url": image_url, "caption": item.draft_text, "access_token": access_token},
                )
                if container_response.status_code >= 400:
                    status, error = MetaGraphErrorClassifier.classify(container_response, "create Instagram media")
                    return MetaTargetResult(target=self.target_name, status=status, error=error)
                container_payload = self._json_response(container_response, "create Instagram media")
                creation_id = str(container_payload.get("id") or "").strip()
                if not creation_id:
                    return MetaTargetResult(
                        target=self.target_name,
                        status="Publish Failed",
                        error="Meta Graph API Instagram media response did not include a creation id.",
                    )

                publish_response = client.post(
                    f"{self.graph_api_base}/{ig_user_id}/media_publish",
                    data={"creation_id": creation_id, "access_token": access_token},
                )
                if publish_response.status_code >= 400:
                    status, error = MetaGraphErrorClassifier.classify(publish_response, "publish Instagram media")
                    return MetaTargetResult(target=self.target_name, status=status, error=error)
                publish_payload = self._json_response(publish_response, "publish Instagram media")
                media_id = str(publish_payload.get("id") or "").strip()
                if not media_id:
                    return MetaTargetResult(
                        target=self.target_name,
                        status="Publish Failed",
                        error="Meta Graph API Instagram publish response did not include a media id.",
                    )

                permalink_response = client.get(
                    f"{self.graph_api_base}/{media_id}",
                    params={"fields": "id,permalink", "access_token": access_token},
                )
        except httpx.HTTPError as exc:
            return MetaTargetResult(target=self.target_name, status="Publish Failed", error=str(exc))

        permalink = None
        if permalink_response.status_code < 400:
            permalink_payload = self._json_response(permalink_response, "fetch Instagram permalink")
            permalink = str(permalink_payload.get("permalink") or "").strip() or None

        return MetaTargetResult(
            target=self.target_name,
            status="Published",
            external_post_id=media_id,
            published_url=permalink,
        )


class MetaPublisher(MetaGraphPublisherMixin):
    """Publishes Meta Dual queue rows as independent Facebook and Instagram targets."""

    def publish(self, item: CampaignContentQueueItem) -> PublisherResult:
        target_results = [
            FacebookPagePublisher(self.settings, self._http_client_factory).publish_target(item),
            InstagramPublisher(self.settings, self._http_client_factory).publish_target(item),
        ]
        return meta_target_results_to_publisher_result(target_results)

    def diagnostics(self) -> dict[str, Any]:
        missing = [
            name
            for name, value in (
                ("FACEBOOK_PAGE_ID", self.settings.facebook_page_id),
                ("FACEBOOK_PAGE_ACCESS_TOKEN", self.settings.facebook_page_access_token),
            )
            if not value
        ]
        diagnostics: dict[str, Any] = {
            "ok": not missing,
            "missing": missing,
            "messages": [],
            "page": None,
            "instagram_business_account": None,
            "configured_instagram_business_account_id": self.settings.instagram_business_account_id,
            "debug_token": None,
        }
        if missing:
            diagnostics["messages"].append(f"Missing required Meta configuration: {', '.join(missing)}")
            return diagnostics

        access_token = self.settings.facebook_page_access_token or ""
        page_id = self.settings.facebook_page_id or ""
        try:
            with self._http_client_factory() as client:
                page_response = client.get(
                    f"{self.graph_api_base}/{page_id}",
                    params={"fields": "id,name,instagram_business_account", "access_token": access_token},
                )
                if self.settings.meta_app_id and self.settings.meta_app_secret:
                    debug_response = client.get(
                        f"{self.graph_api_base}/debug_token",
                        params={
                            "input_token": access_token,
                            "access_token": f"{self.settings.meta_app_id}|{self.settings.meta_app_secret}",
                        },
                    )
                else:
                    debug_response = None
        except httpx.HTTPError as exc:
            diagnostics["ok"] = False
            diagnostics["messages"].append(f"Meta diagnostics request failed: {exc}")
            return diagnostics

        if page_response.status_code >= 400:
            diagnostics["ok"] = False
            diagnostics["messages"].append(self._format_meta_error(page_response, "verify Facebook Page token"))
            return diagnostics

        page_payload = self._json_response(page_response, "verify Facebook Page token")
        diagnostics["page"] = {"id": page_payload.get("id"), "name": page_payload.get("name")}
        linked_ig = page_payload.get("instagram_business_account")
        diagnostics["instagram_business_account"] = linked_ig
        linked_ig_id = linked_ig.get("id") if isinstance(linked_ig, dict) else None
        configured_ig_id = self.settings.instagram_business_account_id
        if not linked_ig_id:
            diagnostics["ok"] = False
            diagnostics["messages"].append("Facebook Page token works, but no linked Instagram Business account was returned.")
        elif configured_ig_id and linked_ig_id != configured_ig_id:
            diagnostics["ok"] = False
            diagnostics["messages"].append(
                "Configured INSTAGRAM_BUSINESS_ACCOUNT_ID does not match the Instagram account linked to the Page."
            )

        if debug_response is None:
            diagnostics["messages"].append("META_APP_ID and META_APP_SECRET are required for /debug_token permission diagnostics.")
            return diagnostics
        if debug_response.status_code >= 400:
            diagnostics["ok"] = False
            diagnostics["messages"].append(self._format_meta_error(debug_response, "debug Meta token"))
            return diagnostics

        debug_payload = self._json_response(debug_response, "debug Meta token")
        debug_data = debug_payload.get("data") if isinstance(debug_payload.get("data"), dict) else {}
        scopes = debug_data.get("scopes") if isinstance(debug_data.get("scopes"), list) else []
        diagnostics["debug_token"] = {"is_valid": debug_data.get("is_valid"), "scopes": scopes}
        required_scopes = {"pages_manage_posts", "pages_read_engagement", "instagram_content_publish"}
        missing_scopes = sorted(required_scopes.difference(set(scopes)))
        if missing_scopes:
            diagnostics["ok"] = False
            diagnostics["messages"].append(f"Token is missing expected permissions: {', '.join(missing_scopes)}")
        return diagnostics


class MetaExportPublisher(MetaGraphPublisherMixin):
    """Creates copy-ready Meta Business Suite packages without calling Meta APIs."""

    def publish(self, item: CampaignContentQueueItem) -> PublisherResult:
        if item.platform not in {"Facebook", "Facebook Page", "Instagram", "Meta Dual"}:
            raise PublishingError(f"Meta export is not configured for platform '{item.platform}'.")

        return PublisherResult(
            status="Ready for Meta Business Suite",
            published="No",
            notes=self.build_meta_business_suite_package(item),
        )

    def build_meta_business_suite_package(self, item: CampaignContentQueueItem) -> str:
        image_value = self.public_image_url(item) or item.image_path or item.image_url or "None selected"
        facebook_caption = item.draft_text if item.platform in {"Facebook", "Facebook Page", "Meta Dual"} else "Not targeted by this row."
        instagram_caption = item.draft_text if item.platform in {"Instagram", "Meta Dual"} else "Not targeted by this row."
        suggested_schedule = item.scheduled_at or "Post when ready."

        return "\n".join(
            [
                "Meta Business Suite Package",
                "",
                "Facebook caption:",
                facebook_caption,
                "",
                "Instagram caption:",
                instagram_caption,
                "",
                f"Image URL/Path: {image_value}",
                f"CTA: {item.cta}",
                f"Landing Page: {item.landing_page_url}",
                f"Suggested Schedule Time: {suggested_schedule}",
            ]
        )


def meta_target_result_to_publisher_result(result: MetaTargetResult) -> PublisherResult:
    notes = format_meta_target_notes([result])
    return PublisherResult(
        external_post_id=format_meta_external_ids([result]),
        published_url=format_meta_published_urls([result]),
        status=result.status,
        published="Yes" if result.succeeded else "No",
        last_publish_error=result.error,
        notes=notes,
    )


def meta_target_results_to_publisher_result(results: list[MetaTargetResult]) -> PublisherResult:
    success_count = sum(1 for result in results if result.succeeded)
    if success_count == len(results):
        status = "Published"
        published = "Yes"
        error = None
    elif success_count > 0:
        status = "Partially Published"
        published = "Partial"
        error = "; ".join(f"{result.target}: {result.error}" for result in results if result.error) or None
    elif any(result.status == "Publish Blocked" for result in results):
        status = "Publish Blocked"
        published = "No"
        error = "; ".join(f"{result.target}: {result.error}" for result in results if result.error) or None
    else:
        status = "Publish Failed"
        published = "No"
        error = "; ".join(f"{result.target}: {result.error}" for result in results if result.error) or None

    return PublisherResult(
        external_post_id=format_meta_external_ids(results),
        published_url=format_meta_published_urls(results),
        status=status,
        published=published,
        last_publish_error=error,
        notes=format_meta_target_notes(results),
    )


def format_meta_external_ids(results: list[MetaTargetResult]) -> str | None:
    values = [f"{result.target}={result.external_post_id}" for result in results if result.external_post_id]
    return "; ".join(values) or None


def format_meta_published_urls(results: list[MetaTargetResult]) -> str | None:
    values = [f"{result.target}={result.published_url}" for result in results if result.published_url]
    return "; ".join(values) or None


def format_meta_target_notes(results: list[MetaTargetResult]) -> str:
    lines = ["Meta target results:"]
    for result in results:
        suffix = " (skipped existing post)" if result.skipped else ""
        details = result.status + suffix
        if result.external_post_id:
            details += f"; external_id={result.external_post_id}"
        if result.published_url:
            details += f"; url={result.published_url}"
        if result.error:
            details += f"; error={result.error}"
        lines.append(f"{result.target}: {details}")
    return "\n".join(lines)


def extract_meta_target_external_id(item: CampaignContentQueueItem, target: str) -> str | None:
    return extract_meta_value(item.external_post_id, target) or extract_meta_value(item.notes, f"{target} External ID")


def extract_meta_target_published_url(item: CampaignContentQueueItem, target: str) -> str | None:
    return extract_meta_value(item.published_url, target) or extract_meta_value(item.notes, f"{target} URL")


def extract_meta_value(value: str | None, key: str) -> str | None:
    if not value:
        return None
    for segment in value.replace("\n", ";").split(";"):
        if "=" in segment:
            raw_key, raw_value = segment.split("=", 1)
        elif ":" in segment:
            raw_key, raw_value = segment.split(":", 1)
        else:
            continue
        if raw_key.strip().lower() == key.strip().lower():
            cleaned = raw_value.strip()
            return cleaned or None
    return None


class GoogleBusinessPublisher:
    """Publisher for owned Google Business Profile Local Posts."""

    account_management_api_base = "https://mybusinessaccountmanagement.googleapis.com/v1"
    business_information_api_base = "https://mybusinessbusinessinformation.googleapis.com/v1"
    oauth_token_url = "https://oauth2.googleapis.com/token"
    summary_max_length = 1500

    def __init__(
        self,
        app_settings: Settings = settings,
        http_client_factory: Callable[[], httpx.Client] | None = None,
    ) -> None:
        self.settings = app_settings
        self._http_client_factory = http_client_factory or (lambda: httpx.Client(timeout=20.0))

    def publish(self, item: CampaignContentQueueItem) -> PublisherResult:
        if not self._is_google_business_platform(item.platform):
            raise PublishingError("Google Business publisher can only publish Google Business queue items.")

        self._validate_publish_credentials()
        body = self.build_local_post_body(item)
        url = self._local_posts_url()

        try:
            with self._http_client_factory() as client:
                access_token = self._refresh_access_token(client)
                response = client.post(
                    url,
                    headers={
                        "Authorization": f"Bearer {access_token}",
                        "Content-Type": "application/json",
                    },
                    json=body,
                )
        except httpx.HTTPError as exc:
            raise PublishingError(f"Google Business API request failed while publishing local post: {exc}") from exc

        if response.status_code >= 400:
            if self._is_legacy_local_posts_api_disabled(response):
                raise ManualPostFallbackRequired(
                    self._legacy_local_posts_api_disabled_message(response),
                    self.build_manual_post_package(item),
                )
            raise PublishingError(self._format_google_error(response, "publish local post"))

        data = self._json_response(response, "publish local post")
        external_post_id = str(
            data.get("name") or data.get("localPostId") or data.get("id") or ""
        ).strip()
        if not external_post_id:
            raise PublishingError("Google Business API response did not include a local post id.")

        published_url = str(data.get("searchUrl") or "").strip() or None
        return PublisherResult(external_post_id=external_post_id, published_url=published_url)

    def verify_credentials(self) -> dict[str, Any]:
        self._validate_oauth_credentials()
        try:
            with self._http_client_factory() as client:
                access_token = self._refresh_access_token(client)
                headers = {"Authorization": f"Bearer {access_token}"}
                accounts_response = client.get(f"{self.account_management_api_base}/accounts", headers=headers)
                locations_response = None
                if self.settings.google_business_account_id:
                    locations_response = client.get(
                        (
                            f"{self.business_information_api_base}/accounts/"
                            f"{self.settings.google_business_account_id}/locations"
                        ),
                        headers=headers,
                        params={"readMask": "name,title,storefrontAddress,metadata"},
                    )
        except httpx.HTTPError as exc:
            raise PublishingError(f"Google Business API request failed while verifying credentials: {exc}") from exc

        if accounts_response.status_code >= 400:
            raise PublishingError(self._format_google_error(accounts_response, "list accounts"))

        payload: dict[str, Any] = {
            "ok": True,
            "account_verification_api": self.account_management_api_base,
            "location_verification_api": self.business_information_api_base,
            "local_posts_publish_api": self._api_base,
            "accounts": self._json_response(accounts_response, "list accounts").get("accounts", []),
        }

        if locations_response is not None:
            if locations_response.status_code >= 400:
                payload["locations_error"] = self._format_google_error(locations_response, "list locations")
            else:
                payload["locations"] = self._json_response(locations_response, "list locations").get(
                    "locations",
                    [],
                )

        payload["configured_account_id"] = self.settings.google_business_account_id
        payload["configured_location_id"] = self.settings.google_business_location_id
        return payload

    @classmethod
    def build_local_post_body(cls, item: CampaignContentQueueItem) -> dict[str, Any]:
        summary = cls._trim_summary(item.draft_text)
        body: dict[str, Any] = {
            "languageCode": "en-US",
            "summary": summary,
            "topicType": "STANDARD",
        }

        if item.landing_page_url:
            body["callToAction"] = {
                "actionType": "LEARN_MORE",
                "url": item.landing_page_url,
            }

        image_url = cls._public_image_url(item)
        if image_url:
            body["media"] = [
                {
                    "mediaFormat": "PHOTO",
                    "sourceUrl": image_url,
                }
            ]

        return body

    @classmethod
    def build_manual_post_package(cls, item: CampaignContentQueueItem) -> str:
        lines = [
            "Manual Google Business Post Package",
            "",
            "Post:",
            cls._trim_summary(item.draft_text),
            "",
            f"CTA: {item.cta}",
            f"CTA Type: LEARN_MORE",
            f"Landing Page URL: {item.landing_page_url}",
        ]
        image_url = cls._public_image_url(item)
        if image_url:
            lines.append(f"Image URL: {image_url}")
        elif item.image_path:
            lines.append(f"Image Path: {item.image_path}")
        return "\n".join(lines)

    def _refresh_access_token(self, client: httpx.Client) -> str:
        self._validate_oauth_credentials()
        data = {
            "client_id": self.settings.google_business_client_id,
            "client_secret": self.settings.google_business_client_secret,
            "refresh_token": self.settings.google_business_refresh_token,
            "grant_type": "refresh_token",
        }

        response = client.post(self.oauth_token_url, data=data)
        if response.status_code >= 400:
            raise PublishingError(self._format_google_error(response, "refresh access token"))

        payload = self._json_response(response, "refresh access token")
        access_token = str(payload.get("access_token") or "").strip()
        if not access_token:
            raise PublishingError("Google OAuth token response did not include an access token.")
        return access_token

    def _validate_publish_credentials(self) -> None:
        self._validate_oauth_credentials()
        missing = [
            env_name
            for env_name, value in (
                ("GOOGLE_BUSINESS_ACCOUNT_ID", self.settings.google_business_account_id),
                ("GOOGLE_BUSINESS_LOCATION_ID", self.settings.google_business_location_id),
            )
            if not value
        ]
        if missing:
            raise PublishingError(f"Missing Google Business publisher configuration: {', '.join(missing)}")

    def _validate_oauth_credentials(self) -> None:
        missing = [
            env_name
            for env_name, value in (
                ("GOOGLE_BUSINESS_CLIENT_ID", self.settings.google_business_client_id),
                ("GOOGLE_BUSINESS_CLIENT_SECRET", self.settings.google_business_client_secret),
                ("GOOGLE_BUSINESS_REFRESH_TOKEN", self.settings.google_business_refresh_token),
            )
            if not value
        ]
        if missing:
            raise PublishingError(f"Missing Google Business OAuth configuration: {', '.join(missing)}")

    @property
    def _api_base(self) -> str:
        return self.settings.google_business_api_base.rstrip("/")

    def _local_posts_url(self) -> str:
        return (
            f"{self._api_base}/accounts/{self.settings.google_business_account_id}"
            f"/locations/{self.settings.google_business_location_id}/localPosts"
        )

    @classmethod
    def _trim_summary(cls, value: str) -> str:
        summary = value.strip()
        if len(summary) <= cls.summary_max_length:
            return summary
        return summary[: cls.summary_max_length].rstrip()

    @staticmethod
    def _public_image_url(item: CampaignContentQueueItem) -> str | None:
        image_url = str(item.image_url or item.image_path or "").strip()
        if image_url.lower().startswith(("http://", "https://")):
            return image_url
        return None

    @staticmethod
    def _is_google_business_platform(platform: str) -> bool:
        return platform.strip().lower() in {"google business", "google business profile"}

    @staticmethod
    def _json_response(response: httpx.Response, action: str) -> dict[str, Any]:
        try:
            payload = response.json()
        except ValueError as exc:
            raise PublishingError(f"Google Business API {action} response was not valid JSON.") from exc
        if not isinstance(payload, dict):
            raise PublishingError(f"Google Business API {action} response was not a JSON object.")
        return payload

    @classmethod
    def _format_google_error(cls, response: httpx.Response, action: str) -> str:
        message = response.text
        try:
            payload = cls._json_response(response, action)
        except PublishingError:
            payload = {}

        error_payload = payload.get("error")
        if isinstance(error_payload, dict):
            message = str(error_payload.get("message") or error_payload)
        elif isinstance(error_payload, str):
            error_description = str(payload.get("error_description") or "").strip()
            message = f"{error_payload}: {error_description}" if error_description else error_payload

        return f"Google Business API failed to {action} ({response.status_code}): {message}"

    @classmethod
    def _is_legacy_local_posts_api_disabled(cls, response: httpx.Response) -> bool:
        if response.status_code != 403:
            return False
        try:
            payload = cls._json_response(response, "inspect local posts publish error")
        except PublishingError:
            payload = {}
        error_payload = payload.get("error")
        message = ""
        if isinstance(error_payload, dict):
            message = str(error_payload.get("message") or "")
            details = error_payload.get("details")
            if isinstance(details, list):
                detail_text = " ".join(str(detail) for detail in details)
                if "SERVICE_DISABLED" in detail_text and "mybusiness.googleapis.com" in detail_text:
                    return True
        elif isinstance(error_payload, str):
            message = error_payload

        normalized = f"{message} {response.text}".lower()
        return "mybusiness.googleapis.com" in normalized and ("disabled" in normalized or "not been used" in normalized)

    @classmethod
    def _legacy_local_posts_api_disabled_message(cls, response: httpx.Response) -> str:
        return (
            f"{cls._format_google_error(response, 'publish local post')} "
            "Local Posts publishing uses the legacy Google My Business API "
            "(mybusiness.googleapis.com/v4). Account and location verification can work through "
            "mybusinessaccountmanagement.googleapis.com and mybusinessbusinessinformation.googleapis.com while "
            "publishing still fails if the Google Cloud project lacks access to the legacy API. "
            "The item was prepared for manual Google Business posting instead."
        )


class PublisherService:
    """Publishing boundary for campaign content.

    Routes and agents should not call platform APIs directly. Real platform
    integrations should be added behind this service.
    """

    def __init__(
        self,
        app_settings: Settings = settings,
        google_business_http_client_factory: Callable[[], httpx.Client] | None = None,
        meta_http_client_factory: Callable[[], httpx.Client] | None = None,
    ) -> None:
        self.settings = app_settings
        self.google_business_http_client_factory = google_business_http_client_factory
        self.meta_http_client_factory = meta_http_client_factory

    def publish_campaign_content(self, item: CampaignContentQueueItem) -> PublisherResult:
        return self._publisher_for(item.platform).publish(item)

    def verify_google_business_credentials(self) -> dict[str, Any]:
        return GoogleBusinessPublisher(
            app_settings=self.settings,
            http_client_factory=self.google_business_http_client_factory,
        ).verify_credentials()

    def meta_diagnostics(self) -> dict[str, Any]:
        return MetaPublisher(
            app_settings=self.settings,
            http_client_factory=self.meta_http_client_factory,
        ).diagnostics()

    def _publisher_for(self, platform: str) -> PlatformPublisher:
        mode = self.settings.publisher_mode.strip().lower()
        if mode == "mock":
            return MockPublisher()
        if mode == "google_business" and platform == "Google Business":
            return GoogleBusinessPublisher(
                app_settings=self.settings,
                http_client_factory=self.google_business_http_client_factory,
            )
        if mode in {"meta", "facebook_page"} and platform in {"Facebook", "Facebook Page"}:
            return FacebookPagePublisher(
                app_settings=self.settings,
                http_client_factory=self.meta_http_client_factory,
            )
        if mode == "meta" and platform == "Instagram":
            return InstagramPublisher(
                app_settings=self.settings,
                http_client_factory=self.meta_http_client_factory,
            )
        if mode == "meta" and platform == "Meta Dual":
            return MetaPublisher(
                app_settings=self.settings,
                http_client_factory=self.meta_http_client_factory,
            )
        if mode == "meta_export" and platform in {"Facebook", "Facebook Page", "Instagram", "Meta Dual"}:
            return MetaExportPublisher(
                app_settings=self.settings,
                http_client_factory=self.meta_http_client_factory,
            )

        raise PublishingError(
            f"Publisher mode '{self.settings.publisher_mode}' is not configured for platform '{platform}'."
        )
