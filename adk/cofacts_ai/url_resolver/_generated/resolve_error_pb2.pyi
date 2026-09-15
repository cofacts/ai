from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from typing import ClassVar as _ClassVar

DESCRIPTOR: _descriptor.FileDescriptor

class ResolveError(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    UNKNOWN_ERROR: _ClassVar[ResolveError]
    NAME_NOT_RESOLVED: _ClassVar[ResolveError]
    INVALID_URL: _ClassVar[ResolveError]
    NOT_REACHABLE: _ClassVar[ResolveError]
    UNSUPPORTED: _ClassVar[ResolveError]
    HTTPS_ERROR: _ClassVar[ResolveError]
    UNKNOWN_SCRAP_ERROR: _ClassVar[ResolveError]
    UNKNOWN_UNFURL_ERROR: _ClassVar[ResolveError]
UNKNOWN_ERROR: ResolveError
NAME_NOT_RESOLVED: ResolveError
INVALID_URL: ResolveError
NOT_REACHABLE: ResolveError
UNSUPPORTED: ResolveError
HTTPS_ERROR: ResolveError
UNKNOWN_SCRAP_ERROR: ResolveError
UNKNOWN_UNFURL_ERROR: ResolveError
