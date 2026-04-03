#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, OVLDSSHAuthenticationMethod) {
  OVLDSSHAuthenticationMethodPassword = 0,
  OVLDSSHAuthenticationMethodKeyboardInteractive = 1,
};

@interface OVLDSSHKeyInstaller : NSObject

+ (nullable NSDictionary<NSString *, id> *)installPublicKeyOnHost:(NSString *)host
                                                             port:(NSInteger)port
                                                         username:(NSString *)username
                                                         password:(NSString *)password
                                                        publicKey:(NSString *)publicKey
                                             authenticationMethod:(OVLDSSHAuthenticationMethod)authenticationMethod
                                                            error:(NSError * _Nullable * _Nullable)error;

@end

NS_ASSUME_NONNULL_END
