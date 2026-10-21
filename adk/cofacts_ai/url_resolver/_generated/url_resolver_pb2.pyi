from . import resolve_error_pb2 as _resolve_error_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class UrlsRequest(_message.Message):
    __slots__ = ("urls",)
    URLS_FIELD_NUMBER: _ClassVar[int]
    urls: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, urls: _Optional[_Iterable[str]] = ...) -> None: ...

class UrlsReply(_message.Message):
    __slots__ = ("reply",)
    REPLY_FIELD_NUMBER: _ClassVar[int]
    reply: _containers.RepeatedCompositeFieldContainer[UrlReply]
    def __init__(self, reply: _Optional[_Iterable[_Union[UrlReply, _Mapping]]] = ...) -> None: ...

class UrlReply(_message.Message):
    __slots__ = ("url", "canonical", "title", "summary", "top_image_url", "html", "status", "error", "successfully_resolved")
    URL_FIELD_NUMBER: _ClassVar[int]
    CANONICAL_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    SUMMARY_FIELD_NUMBER: _ClassVar[int]
    TOP_IMAGE_URL_FIELD_NUMBER: _ClassVar[int]
    HTML_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    SUCCESSFULLY_RESOLVED_FIELD_NUMBER: _ClassVar[int]
    url: str
    canonical: str
    title: str
    summary: str
    top_image_url: str
    html: str
    status: int
    error: _resolve_error_pb2.ResolveError
    successfully_resolved: bool
    def __init__(self, url: _Optional[str] = ..., canonical: _Optional[str] = ..., title: _Optional[str] = ..., summary: _Optional[str] = ..., top_image_url: _Optional[str] = ..., html: _Optional[str] = ..., status: _Optional[int] = ..., error: _Optional[_Union[_resolve_error_pb2.ResolveError, str]] = ..., successfully_resolved: bool = ...) -> None: ...
