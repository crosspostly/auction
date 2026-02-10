/**
 * @fileoverview Functions for checking user subscription status
 */

/**
 * Checks if a user is subscribed to the group
 * @param {string} userId - VK user ID to check
 * @return {boolean} - True if user is member of the group, false otherwise
 */
function checkUserSubscription(userId) {
  try {
    const groupId = getVkGroupId();
    const result = callVk("groups.isMember", {
      group_id: groupId,
      user_id: String(userId)
    });
    
    if (result && result.response !== undefined) {
      return result.response === 1; // VK API returns 1 for member, 0 for non-member
    }
    
    Monitoring.recordEvent('SUBSCRIPTION_CHECK_FAILED', {
      user_id: userId,
      error: 'Invalid response from groups.isMember'
    });
    
    return false;
  } catch (error) {
    logError('checkUserSubscription', error, { user_id: userId });
    return false;
  }
}

/**
 * Validates if a user can participate in the auction based on subscription status
 * @param {string} userId - VK user ID to validate
 * @return {object} - Object with isValid (boolean) and reason (string)
 */
function validateUserParticipation(userId) {
  const settings = getSettings();
  
  // Check if subscription validation is enabled
  if (settings.require_subscription === 'TRUE' || settings.require_subscription === true) {
    const isSubscribed = checkUserSubscription(userId);
    
    if (!isSubscribed) {
      return {
        isValid: false,
        reason: 'Требуется подписка на группу для участия в аукционе'
      };
    }
  }
  
  return {
    isValid: true,
    reason: null
  };
}

/**
 * Enhanced bid validation that includes subscription check
 */
function enhancedValidateBid(bid, lot, userId) {
  // First, perform the standard validation
  const standardValidation = validateBid(bid, lot);
  if (!standardValidation.isValid) {
    return standardValidation;
  }
  
  // Then, check if user meets participation requirements
  const participationValidation = validateUserParticipation(userId);
  if (!participationValidation.isValid) {
    return {
      isValid: false,
      reason: participationValidation.reason
    };
  }
  
  return {
    isValid: true,
    reason: null
  };
}