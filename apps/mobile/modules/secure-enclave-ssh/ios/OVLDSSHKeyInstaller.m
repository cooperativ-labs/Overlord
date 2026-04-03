#import "OVLDSSHKeyInstaller.h"

#include <arpa/inet.h>
#include <sys/socket.h>

#import <CoreFoundation/CoreFoundation.h>
#import "libssh2.h"

static NSString *const OVLDSSHErrorDomain = @"OVLDSSHKeyInstaller";
static NSString *const OVLDSSHErrorStageKey = @"stage";
static NSString *const OVLDSSHSupportedAuthenticationMethodsKey = @"supportedAuthenticationMethods";

typedef struct {
  const char *password;
} OVLDSSHKeyboardContext;

static void OVLDSSHKeyboardInteractiveCallback(const char *name,
                                               int name_len,
                                               const char *instruction,
                                               int instruction_len,
                                               int num_prompts,
                                               const LIBSSH2_USERAUTH_KBDINT_PROMPT *prompts,
                                               LIBSSH2_USERAUTH_KBDINT_RESPONSE *responses,
                                               void **abstract) {
  OVLDSSHKeyboardContext *context = abstract ? *abstract : NULL;
  const char *password = (context && context->password) ? context->password : "";

  for (int index = 0; index < num_prompts; index += 1) {
    responses[index].text = strdup(password);
    responses[index].length = (unsigned int)strlen(password);
  }
}

@interface OVLDSSHConnection : NSObject
@property (nonatomic, assign) CFSocketRef socketRef;
@property (nonatomic, assign) LIBSSH2_SESSION *session;
@property (nonatomic, copy) NSArray<NSString *> *supportedAuthenticationMethods;
@end

@implementation OVLDSSHConnection
- (instancetype)init {
  self = [super init];
  if (self) {
    _socketRef = NULL;
    _session = NULL;
    _supportedAuthenticationMethods = @[];
  }
  return self;
}
@end

@implementation OVLDSSHKeyInstaller

+ (nullable NSDictionary<NSString *, id> *)installPublicKeyOnHost:(NSString *)host
                                                             port:(NSInteger)port
                                                         username:(NSString *)username
                                                         password:(NSString *)password
                                                        publicKey:(NSString *)publicKey
                                             authenticationMethod:(OVLDSSHAuthenticationMethod)authenticationMethod
                                                            error:(NSError * _Nullable __autoreleasing *)error {
  if (![self initializeLibssh2:error]) {
    return nil;
  }

  OVLDSSHConnection *connection = [OVLDSSHConnection new];
  NSDictionary<NSString *, id> *result = nil;

  if (![self openConnection:connection host:host port:port error:error]) {
    [self cleanupConnection:connection];
    return nil;
  }

  if (![self authenticateConnection:connection
                           username:username
                           password:password
                             method:authenticationMethod
                              error:error]) {
    [self cleanupConnection:connection];
    return nil;
  }

  result = [self installAuthorizedKey:publicKey connection:connection error:error];
  [self cleanupConnection:connection];
  return result;
}

+ (BOOL)initializeLibssh2:(NSError * _Nullable __autoreleasing *)error {
  static dispatch_once_t onceToken;
  static int initResult = 0;

  dispatch_once(&onceToken, ^{
    initResult = libssh2_init(0);
  });

  if (initResult == 0) {
    return YES;
  }

  if (error) {
    *error = [NSError errorWithDomain:OVLDSSHErrorDomain
                                 code:initResult
                             userInfo:@{NSLocalizedDescriptionKey: @"Failed to initialize the SSH library."}];
  }
  return NO;
}

+ (BOOL)openConnection:(OVLDSSHConnection *)connection
                  host:(NSString *)host
                  port:(NSInteger)port
                 error:(NSError * _Nullable __autoreleasing *)error {
  CFSocketRef socketRef = [self createConnectedSocketForHost:host port:port error:error];
  if (!socketRef) {
    return NO;
  }

  LIBSSH2_SESSION *session = libssh2_session_init_ex(NULL, NULL, NULL, NULL);
  if (!session) {
    if (error) {
      *error = [NSError errorWithDomain:OVLDSSHErrorDomain
                                   code:-1
                               userInfo:@{
                                 NSLocalizedDescriptionKey: @"Failed to create an SSH session.",
                                 OVLDSSHErrorStageKey: @"connect",
                               }];
    }
    CFSocketInvalidate(socketRef);
    CFRelease(socketRef);
    return NO;
  }

  libssh2_session_set_blocking(session, 1);
  libssh2_session_set_timeout(session, 15000);

  int handshakeResult = libssh2_session_handshake(session, CFSocketGetNative(socketRef));
  if (handshakeResult != 0) {
    if (error) {
      *error = [self sessionErrorWithSession:session
                                        code:handshakeResult
                               defaultMessage:@"The SSH handshake failed."
                                       stage:@"connect"
                    supportedAuthentication:nil];
    }

    libssh2_session_disconnect(session, "Overlord disconnect");
    libssh2_session_free(session);
    CFSocketInvalidate(socketRef);
    CFRelease(socketRef);
    return NO;
  }

  connection.socketRef = socketRef;
  connection.session = session;
  return YES;
}

+ (BOOL)authenticateConnection:(OVLDSSHConnection *)connection
                      username:(NSString *)username
                      password:(NSString *)password
                        method:(OVLDSSHAuthenticationMethod)method
                         error:(NSError * _Nullable __autoreleasing *)error {
  char *authList = libssh2_userauth_list(connection.session, username.UTF8String, (unsigned int)username.length);
  if (authList) {
    NSString *methods = [NSString stringWithUTF8String:authList];
    connection.supportedAuthenticationMethods =
      methods.length > 0 ? [methods componentsSeparatedByString:@","] : @[];
  }

  int authResult = 0;

  switch (method) {
    case OVLDSSHAuthenticationMethodPassword:
      authResult = libssh2_userauth_password_ex(connection.session,
                                                username.UTF8String,
                                                (unsigned int)username.length,
                                                password.UTF8String,
                                                (unsigned int)password.length,
                                                NULL);
      break;

    case OVLDSSHAuthenticationMethodKeyboardInteractive: {
      OVLDSSHKeyboardContext context = {
        .password = password.UTF8String,
      };
      void **abstract = libssh2_session_abstract(connection.session);
      if (abstract) {
        *abstract = &context;
      }
      authResult = libssh2_userauth_keyboard_interactive_ex(connection.session,
                                                            username.UTF8String,
                                                            (unsigned int)username.length,
                                                            OVLDSSHKeyboardInteractiveCallback);
      if (abstract) {
        *abstract = NULL;
      }
      break;
    }
  }

  if (authResult == 0 && libssh2_userauth_authenticated(connection.session) == 1) {
    return YES;
  }

  if (error) {
    *error = [self sessionErrorWithSession:connection.session
                                      code:authResult
                             defaultMessage:@"Authentication failed."
                                     stage:@"authenticate"
                  supportedAuthentication:connection.supportedAuthenticationMethods];
  }
  return NO;
}

+ (nullable NSDictionary<NSString *, id> *)installAuthorizedKey:(NSString *)publicKey
                                                     connection:(OVLDSSHConnection *)connection
                                                          error:(NSError * _Nullable __autoreleasing *)error {
  NSString *escapedKey = [publicKey stringByReplacingOccurrencesOfString:@"'"
                                                              withString:@"'\\''"];
  NSString *command = [@[
    @"mkdir -p ~/.ssh",
    @"chmod 700 ~/.ssh",
    @"touch ~/.ssh/authorized_keys",
    @"chmod 600 ~/.ssh/authorized_keys",
    [NSString stringWithFormat:@"grep -qxF '%@' ~/.ssh/authorized_keys || echo '%@' >> ~/.ssh/authorized_keys",
                               escapedKey,
                               escapedKey],
  ] componentsJoinedByString:@" && "];

  LIBSSH2_CHANNEL *channel = libssh2_channel_open_session(connection.session);
  if (!channel) {
    if (error) {
      *error = [self sessionErrorWithSession:connection.session
                                        code:-1
                               defaultMessage:@"Failed to open an SSH channel."
                                       stage:@"command"
                    supportedAuthentication:connection.supportedAuthenticationMethods];
    }
    return nil;
  }

  libssh2_channel_handle_extended_data2(channel, LIBSSH2_CHANNEL_EXTENDED_DATA_MERGE);

  int execResult = libssh2_channel_exec(channel, command.UTF8String);
  if (execResult != 0) {
    if (error) {
      *error = [self sessionErrorWithSession:connection.session
                                        code:execResult
                               defaultMessage:@"Failed to run the remote install command."
                                       stage:@"command"
                    supportedAuthentication:connection.supportedAuthenticationMethods];
    }
    libssh2_channel_free(channel);
    return nil;
  }

  NSMutableData *outputData = [NSMutableData data];
  char buffer[4096];
  ssize_t readResult = 0;
  do {
    readResult = libssh2_channel_read(channel, buffer, sizeof(buffer));
    if (readResult > 0) {
      [outputData appendBytes:buffer length:(NSUInteger)readResult];
    }
  } while (readResult > 0);

  libssh2_channel_send_eof(channel);
  libssh2_channel_wait_eof(channel);
  libssh2_channel_close(channel);
  int exitStatus = libssh2_channel_get_exit_status(channel);
  libssh2_channel_wait_closed(channel);
  libssh2_channel_free(channel);

  if (exitStatus != 0) {
    NSString *commandOutput = [[NSString alloc] initWithData:outputData encoding:NSUTF8StringEncoding] ?: @"";
    if (error) {
      *error = [NSError errorWithDomain:OVLDSSHErrorDomain
                                   code:exitStatus
                               userInfo:@{
                                 NSLocalizedDescriptionKey: commandOutput.length > 0
                                   ? [NSString stringWithFormat:@"Failed to install key: %@", commandOutput]
                                   : @"Failed to install key on the server.",
                                 OVLDSSHErrorStageKey: @"command",
                               }];
    }
    return nil;
  }

  NSString *output = [[NSString alloc] initWithData:outputData encoding:NSUTF8StringEncoding] ?: @"";
  return @{
    @"success": @YES,
    @"message": @"SSH key installed successfully",
    @"output": output,
  };
}

+ (nullable CFSocketRef)createConnectedSocketForHost:(NSString *)host
                                                port:(NSInteger)port
                                               error:(NSError * _Nullable __autoreleasing *)error {
  CFHostRef hostRef = CFHostCreateWithName(kCFAllocatorDefault, (__bridge CFStringRef)host);
  if (!hostRef) {
    if (error) {
      *error = [NSError errorWithDomain:OVLDSSHErrorDomain
                                   code:-1
                               userInfo:@{
                                 NSLocalizedDescriptionKey: @"Unable to create a host resolver.",
                                 OVLDSSHErrorStageKey: @"connect",
                               }];
    }
    return NULL;
  }

  CFStreamError resolutionError;
  Boolean resolved = CFHostStartInfoResolution(hostRef, kCFHostAddresses, &resolutionError);
  NSArray *addresses = resolved ? (__bridge NSArray *)CFHostGetAddressing(hostRef, NULL) : nil;
  CFRelease(hostRef);

  if (!resolved || addresses.count == 0) {
    if (error) {
      NSString *message = resolved
        ? @"Unable to resolve the host address."
        : [NSString stringWithFormat:@"DNS lookup failed (%ld:%d).",
           (long)resolutionError.domain,
           (int)resolutionError.error];
      *error = [NSError errorWithDomain:OVLDSSHErrorDomain
                                   code:(NSInteger)resolutionError.error
                               userInfo:@{
                                 NSLocalizedDescriptionKey: message,
                                 OVLDSSHErrorStageKey: @"connect",
                               }];
    }
    return NULL;
  }

  for (NSData *addressData in addresses) {
    CFDataRef adjustedAddress = [self copySocketAddress:addressData port:port];
    if (!adjustedAddress) {
      continue;
    }

    const UInt8 *addressBytes = CFDataGetBytePtr(adjustedAddress);
    if (!addressBytes) {
      CFRelease(adjustedAddress);
      continue;
    }

    sa_family_t family = ((const struct sockaddr *)addressBytes)->sa_family;
    CFSocketRef socketRef = CFSocketCreate(kCFAllocatorDefault, family, SOCK_STREAM, IPPROTO_TCP, kCFSocketNoCallBack, NULL, NULL);
    if (!socketRef) {
      CFRelease(adjustedAddress);
      continue;
    }

    int set = 1;
    setsockopt(CFSocketGetNative(socketRef), SOL_SOCKET, SO_NOSIGPIPE, (void *)&set, sizeof(set));

    CFSocketError connectResult = CFSocketConnectToAddress(socketRef, adjustedAddress, 15.0);
    CFRelease(adjustedAddress);

    if (connectResult == kCFSocketSuccess) {
      return socketRef;
    }

    CFSocketInvalidate(socketRef);
    CFRelease(socketRef);
  }

  if (error) {
    *error = [NSError errorWithDomain:OVLDSSHErrorDomain
                                 code:-1
                             userInfo:@{
                               NSLocalizedDescriptionKey: [NSString stringWithFormat:@"Could not connect to %@:%ld.", host, (long)port],
                               OVLDSSHErrorStageKey: @"connect",
                             }];
  }
  return NULL;
}

+ (nullable CFDataRef)copySocketAddress:(NSData *)addressData port:(NSInteger)port {
  if (addressData.length == sizeof(struct sockaddr_in)) {
    struct sockaddr_in address;
    [addressData getBytes:&address length:sizeof(address)];
    address.sin_port = htons((uint16_t)port);
    return CFDataCreate(kCFAllocatorDefault, (const UInt8 *)&address, sizeof(address));
  }

  if (addressData.length == sizeof(struct sockaddr_in6)) {
    struct sockaddr_in6 address;
    [addressData getBytes:&address length:sizeof(address)];
    address.sin6_port = htons((uint16_t)port);
    return CFDataCreate(kCFAllocatorDefault, (const UInt8 *)&address, sizeof(address));
  }

  return NULL;
}

+ (NSError *)sessionErrorWithSession:(LIBSSH2_SESSION *)session
                                code:(NSInteger)code
                       defaultMessage:(NSString *)defaultMessage
                               stage:(NSString *)stage
            supportedAuthentication:(NSArray<NSString *> * _Nullable)supportedAuthentication {
  char *message = NULL;
  int libssh2Code = session ? libssh2_session_last_error(session, &message, NULL, 0) : 0;
  NSString *description = message ? [NSString stringWithUTF8String:message] : defaultMessage;

  NSMutableDictionary *userInfo = [@{
    NSLocalizedDescriptionKey: description.length > 0 ? description : defaultMessage,
    OVLDSSHErrorStageKey: stage,
  } mutableCopy];

  if (supportedAuthentication.count > 0) {
    userInfo[OVLDSSHSupportedAuthenticationMethodsKey] = supportedAuthentication;
  }

  NSInteger resolvedCode = code != 0 ? code : libssh2Code;
  return [NSError errorWithDomain:OVLDSSHErrorDomain code:resolvedCode userInfo:userInfo];
}

+ (void)cleanupConnection:(OVLDSSHConnection *)connection {
  if (connection.session) {
    libssh2_session_disconnect(connection.session, "Overlord disconnect");
    libssh2_session_free(connection.session);
    connection.session = NULL;
  }

  if (connection.socketRef) {
    CFSocketInvalidate(connection.socketRef);
    CFRelease(connection.socketRef);
    connection.socketRef = NULL;
  }
}

@end
